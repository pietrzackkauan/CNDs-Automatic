-- Tabela de Empresas
CREATE TABLE empresas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  cnpj TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Tabela de Lotes (agrupa uma rodada de emissões)
CREATE TABLE lotes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  portal TEXT NOT NULL,
  status TEXT DEFAULT 'pendente' NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Tabela de Itens do Lote (cada certidão individual)
CREATE TABLE lote_itens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lote_id UUID REFERENCES lotes(id) ON DELETE CASCADE,
  empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pendente' NOT NULL, -- pendente, processando, sucesso, erro
  resultado TEXT, -- NEGATIVA, POSITIVA, etc.
  pdf_url TEXT, -- Link para o PDF salvo no Storage
  mensagem_erro TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Políticas de Segurança (RLS - Permite que nosso app acesse as tabelas)
ALTER TABLE empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE lote_itens ENABLE ROW LEVEL SECURITY;

-- Como só teremos uso interno/seguro, vamos liberar acesso total (em produção restringe-se isso)
CREATE POLICY "Liberar tudo empresas" ON empresas FOR ALL USING (true);
CREATE POLICY "Liberar tudo lotes" ON lotes FOR ALL USING (true);
CREATE POLICY "Liberar tudo lote_itens" ON lote_itens FOR ALL USING (true);
