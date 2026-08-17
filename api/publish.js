/**
 * Publicação do modo de edição inline.
 *
 * Antes, o navegador falava direto com a API do GitHub e por isso precisava
 * carregar o token dentro da página — visível para qualquer visitante. Agora
 * o navegador fala com esta função, e o token fica só aqui, nas variáveis de
 * ambiente da Vercel. A senha também deixou de viajar dentro do HTML.
 *
 * Variáveis de ambiente necessárias (painel da Vercel → Settings → Environment Variables):
 *   GITHUB_TOKEN    token com permissão de escrita neste repositório
 *   EDIT_PASSWORD   senha do modo de edição
 *   GITHUB_REPO     opcional, padrão "moveisinovare1-lang/ciquini-bodas-landing"
 */

const crypto = require('crypto');

const FILE = 'index.html';
const BRANCH = 'main';

// O index.html tem ~116 KB. Um envio muito menor que isso significa que a
// captura da página deu errado — melhor recusar do que gravar um site quebrado.
const TAMANHO_MINIMO = 50000;

function senhaConfere(recebida, esperada) {
  const a = Buffer.from(String(recebida));
  const b = Buffer.from(String(esperada));
  // timingSafeEqual exige mesmo tamanho; compara o hash para não vazar o comprimento.
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

async function github(caminho, token, opcoes = {}) {
  const resposta = await fetch('https://api.github.com/repos/' + caminho, {
    ...opcoes,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ciquini-bodas-landing',
      ...(opcoes.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opcoes.headers || {})
    }
  });
  return { status: resposta.status, corpo: await resposta.json().catch(() => ({})) };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'metodo_nao_permitido' });
  }

  const token = process.env.GITHUB_TOKEN;
  const senha = process.env.EDIT_PASSWORD;
  const repo = process.env.GITHUB_REPO || 'moveisinovare1-lang/ciquini-bodas-landing';

  if (!token || !senha) {
    return res.status(500).json({
      erro: 'nao_configurado',
      mensagem: 'Faltam as variáveis GITHUB_TOKEN e/ou EDIT_PASSWORD na Vercel.'
    });
  }

  let corpo = req.body;
  if (typeof corpo === 'string') {
    try { corpo = JSON.parse(corpo); } catch (e) { corpo = {}; }
  }
  corpo = corpo || {};

  if (!corpo.senha || !senhaConfere(corpo.senha, senha)) {
    return res.status(401).json({ erro: 'senha_incorreta' });
  }

  // O modal usa isto só para liberar a edição na tela, sem publicar nada.
  if (corpo.acao === 'verificar') {
    return res.status(200).json({ ok: true });
  }

  const html = corpo.html;
  if (typeof html !== 'string' || html.length < TAMANHO_MINIMO) {
    return res.status(400).json({
      erro: 'html_invalido',
      mensagem: 'A página capturada veio incompleta; nada foi gravado.'
    });
  }
  if (html.indexOf('</html>') === -1) {
    return res.status(400).json({
      erro: 'html_invalido',
      mensagem: 'A página capturada não terminou corretamente; nada foi gravado.'
    });
  }

  try {
    const atual = await github(
      repo + '/contents/' + FILE + '?ref=' + BRANCH,
      token
    );
    if (atual.status !== 200 || !atual.corpo.sha) {
      return res.status(502).json({
        erro: 'github_leitura',
        mensagem: 'Não foi possível ler o arquivo atual no GitHub.',
        detalhe: atual.corpo.message || atual.status
      });
    }

    const gravado = await github(repo + '/contents/' + FILE, token, {
      method: 'PUT',
      body: JSON.stringify({
        message: 'Atualização de conteúdo',
        content: Buffer.from(html, 'utf8').toString('base64'),
        sha: atual.corpo.sha,
        branch: BRANCH
      })
    });

    if (gravado.status !== 200 && gravado.status !== 201) {
      return res.status(502).json({
        erro: 'github_gravacao',
        mensagem: 'O GitHub recusou a gravação.',
        detalhe: gravado.corpo.message || gravado.status
      });
    }

    return res.status(200).json({
      ok: true,
      commit: gravado.corpo.commit && gravado.corpo.commit.sha
    });
  } catch (e) {
    return res.status(502).json({ erro: 'falha_rede', mensagem: 'Falha ao falar com o GitHub.' });
  }
};
