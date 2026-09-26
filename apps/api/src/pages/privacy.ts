// Public privacy policy (Chrome Web Store listing and LGPD). Served at GET /privacidade.
// Keep it in step with what the product actually does: data collected, processors, retention.

export const PRIVACY_UPDATED = '26/09/2026';

const CONTROLLER = {
  name: '65.684.379 THIAGO GONCALVES SOARES SILVA',
  cnpj: '65.684.379/0001-41',
  email: 'thiago.soares@tizzedigital.com',
};

/** Days the data is kept after the subscription is cancelled. */
const RETENTION_DAYS = 90;

export const privacyHtml = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Política de Privacidade · ProcureMate</title>
<meta name="description" content="Como o ProcureMate coleta, usa e protege os dados dos usuários.">
<style>
  :root { --blue: #2563EB; --ink: #172033; --muted: #5B6478; --line: #E2E8F0; --bg: #F8FAFC; --surface: #FFFFFF; }
  @media (prefers-color-scheme: dark) { :root { --ink: #E2E8F0; --muted: #94A3B8; --line: #334155; --bg: #0F172A; --surface: #111827; --blue: #60A5FA; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.65 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  header { background: #2563EB; color: #fff; padding: 32px 16px; }
  header div, main { max-width: 760px; margin: 0 auto; }
  header p { margin: 4px 0 0; opacity: .9; font-size: 14px; }
  h1 { margin: 0; font-size: 28px; line-height: 1.2; }
  main { padding: 24px 16px 64px; }
  section { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 20px 22px; margin: 16px 0; }
  h2 { font-size: 19px; margin: 0 0 8px; }
  h3 { font-size: 16px; margin: 16px 0 4px; }
  p, li { color: var(--ink); }
  ul { padding-left: 20px; margin: 8px 0; }
  li { margin: 4px 0; }
  .muted { color: var(--muted); font-size: 14px; }
  a { color: var(--blue); }
  table { width: 100%; border-collapse: collapse; font-size: 15px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-weight: 600; }
  @media (max-width: 560px) { table, tbody, tr, td, th { display: block; } thead { display: none; } td { border: none; padding: 2px 0; } tr { border-bottom: 1px solid var(--line); padding: 8px 0; } td:first-child { font-weight: 600; } }
</style>
</head>
<body>
<header><div>
  <h1>Política de Privacidade do ProcureMate</h1>
  <p>Última atualização: ${PRIVACY_UPDATED}</p>
</div></header>
<main>

<section>
  <h2>1. Quem somos</h2>
  <p>O ProcureMate é uma extensão para o Google Chrome que ajuda equipes de compras a registrar as cotações recebidas de fornecedores no WhatsApp Web, comparar propostas e gerar pedidos de compra no ERP Omie.</p>
  <p>O responsável pelo tratamento dos dados é <strong>${CONTROLLER.name}</strong>, CNPJ <strong>${CONTROLLER.cnpj}</strong>. Contato para qualquer assunto de privacidade, inclusive como encarregado pelo tratamento de dados (LGPD, art. 41): <a href="mailto:${CONTROLLER.email}">${CONTROLLER.email}</a>.</p>
  <p>O ProcureMate é um produto independente e não tem vínculo com o WhatsApp, a Meta ou a Omie.</p>
</section>

<section>
  <h2>2. Quais dados tratamos</h2>
  <h3>Dados da sua conta</h3>
  <ul>
    <li>E-mail e senha de acesso (a senha é guardada de forma criptografada pelo serviço de login; o ProcureMate não tem acesso a ela).</li>
    <li>Nome e CNPJ da empresa, e os e-mails dos usuários convidados.</li>
    <li>Credenciais de integração com o Omie (App Key e App Secret), guardadas com criptografia.</li>
  </ul>
  <h3>Dados da conversa aberta no WhatsApp Web</h3>
  <ul>
    <li>O ProcureMate lê <strong>somente a conversa que está aberta na tela</strong>, para identificar cotações: o texto das mensagens, o nome e o telefone do contato, e imagens e PDFs recebidos.</li>
    <li>Os trechos da conversa usados para montar uma cotação ficam guardados junto dela, para você conferir a origem de cada valor.</li>
    <li>Imagens e PDFs são lidos no momento e <strong>não são armazenados</strong>; guardamos apenas o nome, o tamanho e uma assinatura digital (hash) do arquivo.</li>
    <li>O ProcureMate <strong>não envia mensagens</strong> por você, não lê outras conversas e não acessa sua lista de contatos. Ele só anexa um arquivo na conversa quando você pede, e o envio continua sendo feito por você no WhatsApp.</li>
  </ul>
  <h3>Dados de compras</h3>
  <ul>
    <li>Fornecedores (nome, CNPJ, telefone, e-mail), cotações, itens, comparativos e pedidos de compra.</li>
    <li>Cópia de fornecedores, produtos, condições de pagamento e pedidos lidos do seu Omie, para mostrar o histórico de compras.</li>
  </ul>
  <h3>Dados de uso e cobrança</h3>
  <ul>
    <li>Quantidade de leituras feitas pela IA e registros de uso do produto (por exemplo: cotação registrada, pedido gerado), para medir o plano, dar suporte e melhorar o serviço.</li>
    <li>Plano, situação da assinatura e dados de cobrança da empresa (razão social, CNPJ e e-mail). Os dados de pagamento (cartão, Pix ou boleto) são informados diretamente na página do Asaas e não passam pelo ProcureMate.</li>
  </ul>
  <h3>Dados guardados no seu navegador</h3>
  <p>A extensão guarda no próprio Chrome a sessão de login, suas preferências do painel, as cotações lidas ainda não salvas e os telefones dos contatos que você abriu no WhatsApp. Esses dados ficam só no seu computador e são apagados ao remover a extensão. O ProcureMate não usa cookies de rastreamento nem publicidade.</p>
</section>

<section>
  <h2>3. Para que usamos os dados</h2>
  <ul>
    <li>Identificar cotações nas conversas e montar as cotações, comparativos e pedidos de compra.</li>
    <li>Reconhecer o fornecedor da conversa e mostrar o histórico de compras no Omie.</li>
    <li>Criar fornecedores e pedidos no Omie e enviar o pedido por e-mail, quando você pede.</li>
    <li>Controlar o plano contratado, cobrar a assinatura e emitir nota fiscal.</li>
    <li>Dar suporte, garantir a segurança e melhorar a qualidade das leituras.</li>
  </ul>
  <p>Não vendemos dados, não usamos os dados para publicidade e não os usamos para nenhuma finalidade sem relação com o serviço.</p>
  <p><strong>Bases legais (LGPD, art. 7º):</strong> execução do contrato com a empresa cliente (inciso V), cumprimento de obrigação legal, como registros fiscais de cobrança (inciso II), e legítimo interesse para segurança, suporte e melhoria do serviço (inciso IX).</p>
</section>

<section>
  <h2>4. Dados de terceiros nas conversas</h2>
  <p>As conversas contêm dados dos fornecedores da empresa cliente (nome, telefone, e-mail e propostas). Em relação a esses dados, o ProcureMate atua como <strong>operador</strong>, tratando-os apenas em nome da empresa cliente e conforme as instruções dela, que é a controladora desses dados.</p>
</section>

<section>
  <h2>5. Com quem compartilhamos</h2>
  <p>Os dados são compartilhados apenas com os serviços necessários para o ProcureMate funcionar:</p>
  <table>
    <thead><tr><th>Serviço</th><th>Para quê</th></tr></thead>
    <tbody>
      <tr><td>Supabase</td><td>Banco de dados e login de usuários.</td></tr>
      <tr><td>Render</td><td>Hospedagem do servidor do ProcureMate.</td></tr>
      <tr><td>Anthropic (Claude)</td><td>Inteligência artificial que lê as mensagens, imagens e PDFs e identifica as cotações. Conforme os termos comerciais da Anthropic, os dados enviados pela API não são usados para treinar seus modelos.</td></tr>
      <tr><td>Omie</td><td>ERP da empresa cliente: leitura de fornecedores, produtos e pedidos, e criação de fornecedores e pedidos, quando a empresa conecta a conta.</td></tr>
      <tr><td>Asaas</td><td>Cobrança da assinatura e emissão de nota fiscal.</td></tr>
      <tr><td>Resend</td><td>Envio do pedido de compra por e-mail ao fornecedor, quando você pede.</td></tr>
    </tbody>
  </table>
  <p>Também podemos compartilhar dados quando exigido por lei ou por ordem de autoridade competente.</p>
  <p><strong>Transferência internacional:</strong> alguns desses serviços armazenam ou processam dados fora do Brasil (por exemplo, nos Estados Unidos). Essas transferências são feitas para a execução do contrato e com fornecedores que adotam medidas de segurança adequadas, conforme o art. 33 da LGPD.</p>
</section>

<section>
  <h2>6. Por quanto tempo guardamos</h2>
  <ul>
    <li>Enquanto a assinatura da empresa estiver ativa.</li>
    <li>Após o cancelamento, os dados são mantidos por <strong>${RETENTION_DAYS} dias</strong>, para o caso de a empresa voltar, e depois excluídos.</li>
    <li>Registros de cobrança e notas fiscais são guardados pelo prazo exigido pela legislação fiscal.</li>
    <li>A empresa pode pedir a exclusão antes desse prazo pelo e-mail de contato.</li>
  </ul>
</section>

<section>
  <h2>7. Segurança</h2>
  <p>Toda a comunicação entre a extensão e o servidor é criptografada (HTTPS). As credenciais do Omie são guardadas com criptografia, o acesso aos dados é restrito aos usuários de cada empresa, e cada empresa só vê os próprios dados.</p>
</section>

<section>
  <h2>8. Seus direitos</h2>
  <p>Pela LGPD (art. 18), você pode pedir, a qualquer momento:</p>
  <ul>
    <li>confirmação de que tratamos seus dados e acesso a eles;</li>
    <li>correção de dados incompletos ou desatualizados;</li>
    <li>anonimização, bloqueio ou exclusão de dados desnecessários;</li>
    <li>portabilidade dos dados;</li>
    <li>informação sobre com quem compartilhamos os dados;</li>
    <li>revogação do consentimento, quando for o caso.</li>
  </ul>
  <p>Para exercer esses direitos, escreva para <a href="mailto:${CONTROLLER.email}">${CONTROLLER.email}</a>. Respondemos em até 15 dias. Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).</p>
</section>

<section>
  <h2>9. Menores de idade</h2>
  <p>O ProcureMate é um serviço para empresas e não se destina a menores de 18 anos.</p>
</section>

<section>
  <h2>10. Mudanças nesta política</h2>
  <p>Podemos atualizar esta política. A data da última atualização fica no topo da página, e mudanças importantes são avisadas aos clientes por e-mail ou no próprio ProcureMate.</p>
</section>

<p class="muted">${CONTROLLER.name} · CNPJ ${CONTROLLER.cnpj} · <a href="mailto:${CONTROLLER.email}">${CONTROLLER.email}</a></p>
</main>
</body>
</html>`;
