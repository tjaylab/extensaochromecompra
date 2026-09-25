# Compras WhatsApp

Extensão para Chrome que transforma propostas de fornecedores recebidas no WhatsApp Web em cotações estruturadas, compara propostas de uma mesma requisição e envia o pedido de compra escolhido ao Omie.

```
WhatsApp Web ──seleção──▶ extensão (painel lateral) ──▶ API ──▶ Claude (extração)
                                                          ├──▶ Supabase (Postgres + Auth)
                                                          └──▶ Omie (fornecedores, produtos, pedidos)
```

| Pasta | O que é |
| --- | --- |
| `apps/extension` | Extensão Chrome MV3 (WXT + React): botão flutuante no WhatsApp Web, menu de contexto e painel lateral |
| `apps/api` | API Fastify: extração com Claude, cotações, requisições, comparação, pedidos e integração Omie |
| `packages/shared` | Esquemas (Zod), tipos e utilitários usados pelos dois lados |

## Rodar localmente (sem serviços externos)

Requer Node 22+.

```bash
npm install
cp apps/api/.env.example apps/api/.env      # modo dev: PGlite, login só com e-mail, extração local, Omie simulado
npm run dev:api                             # http://localhost:8787
```

Em outro terminal, gere a extensão e carregue no Chrome:

```bash
npm run build:ext
```

1. Abra `chrome://extensions`, ative o **Modo do desenvolvedor**.
2. **Carregar sem compactação** › selecione `apps/extension/.output/chrome-mv3`.
3. Abra o WhatsApp Web, selecione o texto de uma proposta e clique em **Registrar cotação** (ou botão direito › Registrar cotação).

`apps/extension/.env` controla para qual API e qual modo de login a extensão aponta (veja `apps/extension/.env.example`). Para desenvolver com recarga automática: `npm run dev:ext`.

Para testar o painel numa aba comum, sem instalar a extensão: `npm run preview:panel` e abra http://localhost:5174. No console: `__openChat('Carlos (Microsemi)', '+55 11 97000-1234')` simula abrir uma conversa (mostra o histórico do fornecedor), `__conversation = [...]` define as mensagens lidas por "Registrar da conversa aberta" e `__capture('Consigo 30 fontes…', 'Carlos (Microsemi)')` simula uma seleção.

### Testes

```bash
npm test          # 38 testes da API: fluxo completo, isolamento entre empresas, falhas do Omie, cliente Omie
npm run typecheck
```

## Piloto com Supabase, Claude e Omie

### 1. Supabase

1. Crie um projeto em [supabase.com](https://supabase.com) (região São Paulo).
2. **Project Settings › Database › Connection string**: copie a URI do *Transaction pooler* (porta 6543) para `DATABASE_URL`.
3. **Project Settings › API**: copie a *Project URL* (`SUPABASE_URL` na API e `WXT_SUPABASE_URL` na extensão) e a *anon public key* (`WXT_SUPABASE_ANON_KEY`).
4. **Authentication › Providers › Email**: mantenha habilitado. Para o piloto, desative *Confirm email* se não quiser que cada comprador confirme o e-mail antes do primeiro acesso.
5. As tabelas são criadas automaticamente quando a API sobe (ou rode `npm run db:migrate -w @compras/api`). Todas ficam com RLS ativo e sem políticas: não são acessíveis pela API REST pública do Supabase, só pela nossa API.

O token do Supabase é validado pelo JWKS do projeto. Projetos antigos que ainda usam o segredo HS256 legado: preencha `SUPABASE_JWT_SECRET`.

### 2. Claude

Crie uma chave em [console.anthropic.com](https://console.anthropic.com) e preencha `ANTHROPIC_API_KEY`. A extração usa `claude-opus-5` com esforço `low` e saída estruturada validada por esquema (`apps/api/src/extraction`). Se um filtro de segurança recusar uma mensagem, a API refaz a chamada no modelo de fallback recomendado (`fallbacks: "default"`); se ainda assim falhar, o comprador preenche manualmente.

### 3. Omie

Cada empresa conecta a própria conta em **Configurações › ERP Omie** na extensão (App Key e App Secret, em Omie › Configurações › Aplicativos). As credenciais são testadas antes de salvar e ficam criptografadas (AES-256-GCM) com `ENCRYPTION_KEY`.

Chamadas usadas: `ListarParcelas`, `ListarProdutos`, `ListarClientes`, `UpsertCliente` (tag *Fornecedor*) e `UpsertPedCompra` com código de integração `PC-0001`, o que torna o reenvio seguro contra duplicidade. O pedido de compra do Omie não tem campo de moeda: cotações em USD ou EUR vão em reais pela taxa informada pelo comprador, e moeda e taxa ficam em `cObs`.

### 4. Subir a API

Variáveis em `apps/api/.env.example` (seção *Pilot / production*). Com Docker, a partir da raiz:

```bash
docker build -f apps/api/Dockerfile -t compras-api .
```

Qualquer serviço que rode um container serve (Render, Railway, Fly). Depois de publicar a extensão, restrinja `CORS_ORIGINS` a `chrome-extension://<id da extensão>`.

### 5. Distribuir a extensão

Defina `WXT_API_URL`, `WXT_AUTH_MODE=supabase`, `WXT_SUPABASE_URL` e `WXT_SUPABASE_ANON_KEY` em `apps/extension/.env.production` e rode `npm run zip -w @compras/extension`. Publique como **não listada** na Chrome Web Store e envie o link aos compradores do piloto.

## Métricas do piloto

**Configurações › Piloto** (administradores) mostra:

- tempo mediano entre o clique em *Registrar cotação* e *Salvar* e o percentual abaixo de 1 minuto;
- cotações por comprador;
- percentual de cotações com algum campo corrigido e os campos mais corrigidos, que servem de medida da qualidade da extração.

Os eventos brutos ficam na tabela `events`.

## Limitações conhecidas do MVP

- A identificação do contato depende da estrutura da página do WhatsApp Web (`apps/extension/lib/whatsapp-dom.ts`). Se ela mudar, a captura continua funcionando e o comprador escolhe o fornecedor na mão.
- A fila de envio ao Omie roda dentro do processo da API: pedidos interrompidos são retomados quando a API reinicia. Para mais de uma instância, troque por uma fila no Postgres (por exemplo, pg-boss).
- Os limites de chamada da API do Omie não são publicados. Erros de consumo redundante e de rede são repetidos até 5 vezes, com espera exponencial.
- Produtos precisam existir no Omie. A extensão busca e sugere, mas não cadastra produtos.
