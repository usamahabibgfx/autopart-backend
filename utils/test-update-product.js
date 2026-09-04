const http = require('http');

const loginData = JSON.stringify({
    email: 'admin@bestsignatureautoparts.com',
    password: 'admin123_secure'
});

const loginOptions = {
    hostname: 'localhost',
    port: 5000,
    path: '/api/v1/auth/login',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': loginData.length
    }
};

const updateData = JSON.stringify({
    name: 'Updated Convection Oven',
    price: 4999.99,
    image_url: 'http://example.com/new-image.jpg'
});

const productId = 1;

const updateProduct = (token) => {
    const options = {
        hostname: 'localhost',
        port: 5000,
        path: `/api/v1/products/${productId}`,
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': updateData.length,
            'Authorization': `Bearer ${token}`
        }
    };

    console.log(`Updating product ${productId}...`);

    const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
            console.log('--- Update Product Response ---');
            console.log(`Status: ${res.statusCode}`);
            console.log(body);

            if (res.statusCode === 200) {
                verifyUpdate(token);
            } else {
                process.exit(1);
            }
        });
    });

    req.on('error', (e) => {
        console.error('Error updating product:', e.message);
        process.exit(1);
    });

    req.write(updateData);
    req.end();
};

const verifyUpdate = (token) => {
    const options = {
        hostname: 'localhost',
        port: 5000,
        path: `/api/v1/products/${productId}`,
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`
        }
    };

    console.log(`Verifying product ${productId}...`);

    const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
            console.log('--- Get Product Response ---');
            const product = JSON.parse(body);
            console.log(JSON.stringify(product, null, 2));
            process.exit(0);
        });
    });

    req.end();
};

const loginReq = http.request(loginOptions, (res) => {
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => {
        const response = JSON.parse(body);
        if (response.success && response.token) {
            console.log('Login Successful');
            updateProduct(response.token);
        } else {
            console.error('Login Failed:', body);
            process.exit(1);
        }
    });
});

loginReq.on('error', (e) => {
    console.error('Login error:', e.message);
    process.exit(1);
});

loginReq.write(loginData);
loginReq.end();
