-- Script atualizado para tabela de empresas com suporte a Município, Inscrição Municipal e Login Criptografado
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS municipio TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS inscricao_municipal TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS login_encrypted TEXT;
