const imap = require('imap');
const { simpleParser } = require('mailparser');
const fs = require('fs');
const { execSync } = require('child_process');

const CONFIG = {
  email: {
    user: process.env.EMAIL_USER,
    password: process.env.EMAIL_PASS,
    host: 'imap.qq.com',
    port: 993,
    tls: true
  }
};

function checkEmails() {
  return new Promise((resolve, reject) => {
    const client = new imap({
      user: CONFIG.email.user,
      password: CONFIG.email.password,
      host: CONFIG.email.host,
      port: CONFIG.email.port,
      tls: true,
      tlsOptions: { rejectUnauthorized: false }
    });

    const emails = [];

    client.once('ready', () => {
      client.openBox('INBOX', false, (err, box) => {
        if (err) return reject(err);

        // 改为通过 HEADER 模糊匹配 Subject 中包含 Kindle 的邮件，并打印搜索结果以便调试
        client.search(['UNSEEN', ['HEADER', 'SUBJECT', 'Kindle']], (err, results) => {
          if (err) {
            console.error('IMAP search error:', err);
            client.end();
            return reject(err);
          }

          console.log('IMAP search results ids:', results);

          if (!results || results.length === 0) {
            client.end();
            return resolve([]);
          }

          // 请求 struct 以便后续可读到 attributes（包含 uid）
          const fetch = client.fetch(results, { bodies: '', struct: true });

          fetch.on('message', (msg, seqno) => {
            let buffer = '';
            msg.on('body', (stream) => {
              stream.on('data', (chunk) => buffer += chunk);
            });

            // 保存 attributes 以获取 uid
            msg.once('attributes', (attrs) => {
              msg._attrs = attrs;
            });

            msg.once('end', async () => {
              try {
                const parsed = await simpleParser(buffer);
                // 优先使用纯文本，如果没有则使用 HTML（去除标签）
                const bodyText = parsed.text ||
                                 (parsed.html ? parsed.html.replace(/<[^>]*>/g, '') : '') ||
                                 '无正文';

                const uid = (msg._attrs && msg._attrs.uid) || seqno;

                emails.push({
                  subject: parsed.subject,
                  text: bodyText,
                  date: new Date().toISOString().split('T')[0],
                  uid
                });

                console.log(`Parsed email uid=${uid} subject=${parsed.subject}`);

                // 使用标准的 \Seen flag 并打印结果
                client.addFlags(uid, '\\Seen', (err) => {
                  if (err) console.error('addFlags error for uid', uid, err);
                  else console.log('Marked seen uid=', uid);
                });

              } catch (e) { console.error('Parse error:', e); }
            });
          });

          fetch.once('error', (e) => { console.error('Fetch error:', e); reject(e); });
          fetch.once('end', () => {
            setTimeout(() => { client.end(); resolve(emails); }, 1000);
          });
        });
      });
    });

    client.once('error', (err) => { console.error('IMAP client error:', err); reject(err); });
    client.connect();
  });
}

function createPost(email) {
  const title = email.subject;
  const date = email.date;
  const slug = title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '-').substring(0, 30);
  const filename = `_posts/${date}-${slug}.html`;

  fs.mkdirSync('_posts', { recursive: true });

  const paragraphs = email.text.split('\n\n')
    .filter(p => p.trim())
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`) 
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <style>
        body{font-family:"Noto Serif SC","SimSun",serif;font-size:22px;
             line-height:1.8;max-width:90%;margin:40px auto;padding:20px;}
        h1{font-size:28px;text-align:center;border-bottom:2px solid #000;
           padding-bottom:15px;}
        .date{text-align:center;color:#666;font-size:16px;margin-bottom:30px;}
        p{margin-bottom:20px;text-align:justify;text-indent:2em;}
        .nav{margin-top:40px;padding-top:20px;border-top:1px solid #ccc;text-align:center;}
    </style>
</head>
<body>
    <h1>${title}</h1>
    <div class="date">${date}</div>
    ${paragraphs}
    <div class="nav"><a href="../index.html">← 返回首页</a></div>
</body>
</html>`;

  fs.writeFileSync(filename, html);
  console.log('Created:', filename);
}

function updateIndex() {
  const postsDir = '_posts';
  if (!fs.existsSync(postsDir) || fs.readdirSync(postsDir).length === 0) {
    console.log('No posts yet');
    return;
  }

  const files = fs.readdirSync(postsDir).filter(f => f.endsWith('.html'));
  files.sort().reverse();

  let postsHtml = files.map(file => {
    const content = fs.readFileSync(postsDir + '/' + file, 'utf8');
    const titleMatch = content.match(/<title>(.*?)<\/title>/);
    const dateMatch = content.match(/<div class="date">(.*?)<\/div>/);
    const title = titleMatch ? titleMatch[1] : '无标题';
    const date = dateMatch ? dateMatch[1] : '';
    return `<div class="post"><div class="date">${date}</div><a href="_posts/${file}">${title}</a></div>`;
  }).join('');

  const indexHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>Kindle阅读</title>
    <style>
        *{margin:0;padding:0;box-sizing:border-box;}
        body{font-family:"Noto Serif SC","SimSun",serif;font-size:22px;
             line-height:1.8;max-width:90%;margin:40px auto;padding:20px;}
        h1{font-size:28px;text-align:center;margin-bottom:30px;
           padding-bottom:15px;border-bottom:2px solid #000;}
        .post{margin:25px 0;padding:15px 0;border-bottom:1px dashed #666;}
        .date{font-size:16px;color:#333;margin-bottom:5px;}
        a{color:#000;text-decoration:none;font-size:24px;}
        a:hover{text-decoration:underline;}
        .nav{margin-top:40px;padding-top:20px;border-top:2px solid #000;
             text-align:center;font-size:16px;color:#666;}
    </style>
</head>
<body>
    <h1>📚 我的阅读笔记</h1>
    ${postsHtml}
    <div class="nav">共 ${files.length} 篇文章 | QQ邮箱发布</div>
</body>
</html>`;

  fs.writeFileSync('index.html', indexHtml);
  console.log('Updated index with', files.length, 'posts');
}

async function main() {
  try {
    const emails = await checkEmails();
    console.log('Found emails:', emails.length);

    if (emails.length === 0) {
      console.log('No new emails');
      return;
    }

    for (const email of emails) {
      createPost(email);
    }

    updateIndex();

    // 更详细地打印 git 操作输出，便于排查 push 是否真的成功
    execSync('git config user.name "Email Bot"');
    execSync('git config user.email "bot@example.com"');
    execSync('git add .');

    try {
      const commitOut = execSync('git commit -m "Add posts from email"').toString();
      console.log('git commit output:', commitOut);
    } catch (e) {
      console.error('git commit warning (maybe no changes):', e.stdout ? e.stdout.toString() : e.message);
    }

    try {
      const pushOut = execSync('git push').toString();
      console.log('git push output:', pushOut);
    } catch (e) {
      console.error('git push failed:', e.stdout ? e.stdout.toString() : e.message);
      throw e; // 抛出以便外层 catch 处理并终止进程（根据需要你也可以不抛出）
    }
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();
