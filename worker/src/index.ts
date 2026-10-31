import { supabase, supabaseUrl, supabaseKey } from "./supabase";
export { supabase, supabaseUrl, supabaseKey };
import { processarTST } from "./tst";
import { processarFederal } from "./federal";
import { processarFGTS } from "./fgts";
import { obterConfiguracaoCidade } from "./municipais/cidades";
import { processarMunicipal } from "./municipais";
import { processarEstadual } from "./estaduais";
import { decryptText } from "./crypto";

import { obterCertificadoPrincipal } from "./certs";

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processarItem(item: any) {
  const perfilCert = typeof item.resultado === "string" && item.resultado.startsWith("CERT:")
    ? item.resultado
    : "AUTO";
  const certInfo = obterCertificadoPrincipal(perfilCert);

  console.log(`\nIniciando processamento: Empresa ID ${item.empresa_id} | Portal: ${item.lotes.portal} | Certificado: ${certInfo ? certInfo.nome : "Nenhum"}`);
  
  // Buscar os dados completos da empresa
  const { data: empresa } = await supabase
    .from('empresas')
    .select('cnpj, nome, municipio, inscricao_municipal, login_encrypted')
    .eq('id', item.empresa_id)
    .single();

  if (!empresa) {
    throw new Error("Empresa não encontrada no banco");
  }

  console.log(`- Alvo: ${empresa.nome} (CNPJ: ${empresa.cnpj}) | Cidade: ${empresa.municipio || "Não informada"}`);

  let resultado;

  if (item.lotes.portal === 'TRABALHISTA') {
    resultado = await processarTST(empresa.cnpj);
  } else if (item.lotes.portal === 'CAIXA') {
    resultado = await processarFGTS(empresa.cnpj);
  } else if (item.lotes.portal === 'FEDERAL') {
    resultado = await processarFederal(empresa.cnpj, perfilCert);
  } else if (item.lotes.portal === 'MUNICIPAL') {
    if (!empresa.municipio) {
      resultado = {
        status: 'alerta',
        resultado: 'SEM CIDADE',
        mensagem_erro: 'Coluna Município não foi preenchida na planilha.'
      };
    } else {
      const config = obterConfiguracaoCidade(empresa.municipio);
      if (!config) {
        resultado = {
          status: 'alerta',
          resultado: 'CIDADE NÃO MAPEADA',
          mensagem_erro: `O município "${empresa.municipio}" ainda não está no catálogo de robôs.`
        };
      } else if (config.exigeInscricaoMunicipal && !empresa.inscricao_municipal) {
        resultado = {
          status: 'alerta',
          resultado: 'FALTA INSC. MUNICIPAL',
          mensagem_erro: `A prefeitura de ${config.nomeOficial} (${config.uf}) exige a Inscrição Municipal na planilha.`
        };
      } else if (config.exigeLogin && !empresa.login_encrypted && !certInfo) {
        resultado = {
          status: 'alerta',
          resultado: 'FALTA ACESSO/LOGIN',
          mensagem_erro: `A prefeitura de ${config.nomeOficial} (${config.uf}) exige Login na planilha ou Certificado Digital A1.`
        };
      } else {
        // Descriptografa as credenciais em memória com segurança máxima
        const credenciais = empresa.login_encrypted ? decryptText(empresa.login_encrypted) : "";
        console.log(`- [MUNICIPAL] Roteando para ${config.nomeOficial} (${config.uf}) via motor ${config.engine} (URL: ${config.url})`);
        
        resultado = await processarMunicipal(empresa, config, credenciais, perfilCert);
      }
    }
  } else if (item.lotes.portal === 'ESTADUAL') {
    resultado = await processarEstadual(empresa, perfilCert);
  } else {
    resultado = { status: 'erro', resultado: 'ERRO', mensagem_erro: `Portal ${item.lotes.portal} não implementado` };
  }

  console.log(`- Status Final: ${resultado.status} | Resultado: ${resultado.resultado}`);

  // Verifica se o item foi cancelado pelo usuário durante o processamento
  const { data: checkItem } = await supabase
    .from('lote_itens')
    .select('status')
    .eq('id', item.id)
    .single();

  if (checkItem?.status === 'cancelado') {
    console.log(`- Item ${item.id} foi cancelado pelo usuário durante o processamento. Descartando resultado.`);
    return;
  }

  // Atualiza no banco
  await supabase
    .from('lote_itens')
    .update({ 
      status: resultado.status,
      resultado: resultado.resultado,
      pdf_url: resultado.pdf_url || null,
      mensagem_erro: resultado.mensagem_erro || null
    })
    .eq('id', item.id)
    .neq('status', 'cancelado');

  // Verifica se o lote todo foi concluído
  try {
    const { data: remaining } = await supabase
      .from('lote_itens')
      .select('id')
      .eq('lote_id', item.lote_id)
      .in('status', ['pendente', 'processando']);

    if (!remaining || remaining.length === 0) {
      await supabase
        .from('lotes')
        .update({ status: 'concluido' })
        .eq('id', item.lote_id);
      console.log(`- Lote ${item.lote_id} 100% finalizado!`);
    }
  } catch (loteErr) {
    console.warn("Aviso ao atualizar status do lote:", loteErr);
  }
    
  console.log(`Concluído: ${empresa.cnpj}`);
}

async function mainLoop() {
  console.log("Robô de CNDs iniciado. Aguardando tarefas...");

  // Recupera quaisquer itens que tenham ficado presos em 'processando' por interrupção
  try {
    await supabase
      .from('lote_itens')
      .update({ status: 'pendente' })
      .eq('status', 'processando');
  } catch (err) {
    console.warn("Aviso ao recuperar fila:", err);
  }

  while (true) {
    try {
      // Busca 1 item pendente na fila (ignora cancelados)
      const { data: itens, error } = await supabase
        .from('lote_itens')
        .select('*, lotes(portal)')
        .eq('status', 'pendente')
        .order('created_at', { ascending: true })
        .limit(1);

      if (error) {
        console.error("Erro ao buscar fila:", error.message);
        await sleep(5000);
        continue;
      }

      if (itens && itens.length > 0) {
        const item = itens[0];

        // Trava o registro para 'processando', garantindo que não foi cancelado
        const { data: locked, error: lockErr } = await supabase
          .from('lote_itens')
          .update({ status: 'processando' })
          .eq('id', item.id)
          .eq('status', 'pendente')
          .select('id, status');

        if (lockErr || !locked || locked.length === 0) {
          console.log(`Item ${item.id} já não está mais pendente ou foi cancelado. Próximo...`);
          continue;
        }

        try {
          await processarItem(item);
        } catch (err: any) {
          console.error(`Erro no processamento do item ${item.id}:`, err.message);
          
          // Só salva como erro se o usuário não cancelou
          const { data: itemCancelado } = await supabase
            .from('lote_itens')
            .select('status')
            .eq('id', item.id)
            .single();

          if (itemCancelado?.status !== 'cancelado') {
            await supabase
              .from('lote_itens')
              .update({ status: 'erro', resultado: 'ERRO', mensagem_erro: err.message })
              .eq('id', item.id);
          }
        }
      } else {
        // Nenhuma tarefa pendente. Verifica se há itens presos em 'processando' há mais de 3 minutos
        try {
          const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();
          const { data: staleItens } = await supabase
            .from('lote_itens')
            .select('id')
            .eq('status', 'processando')
            .lt('created_at', threeMinutesAgo)
            .limit(5);

          if (staleItens && staleItens.length > 0) {
            const staleIds = staleItens.map(i => i.id);
            console.log(`[RECUPERAÇÃO AUTOMÁTICA] Destravando ${staleIds.length} itens presos em 'processando'...`);
            await supabase
              .from('lote_itens')
              .update({ status: 'pendente' })
              .in('id', staleIds);
          }
        } catch (recoverErr) {
          console.warn("[RECUPERAÇÃO] Aviso ao verificar itens presos:", recoverErr);
        }

        // Dorme por 3 segundos
        await sleep(3000);
      }
    } catch (e) {
      console.error("Erro crítico no loop principal:", e);
      await sleep(5000);
    }
  }
}

mainLoop();
