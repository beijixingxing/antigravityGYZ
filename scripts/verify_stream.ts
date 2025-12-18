import http from 'http';

const postData = JSON.stringify({
  messages: [
    { role: "user", content: "Hello, count from 1 to 3." }
  ],
  model: "gemini-1.5-flash-latest", // 使用一个存在的模型
  stream: true,
  temperature: 0.7
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/v1/chat/completions',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData),
    'Authorization': 'Bearer test_key' // 需要确保数据库里有这个 key
  }
};

console.log('--- Sending Request ---');
console.log(postData);
console.log('-----------------------\n');

const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
  console.log('--- Response Body ---');
  
  res.setEncoding('utf8');
  res.on('data', (chunk) => {
    console.log(chunk);
  });
  
  res.on('end', () => {
    console.log('\n--- End of Response ---');
  });
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
});

req.write(postData);
req.end();
