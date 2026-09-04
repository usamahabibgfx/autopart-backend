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

const productData = JSON.stringify({
    name: 'Commercial Convection Oven',
    description: 'High-performance stainless steel convection oven for professional kitchens.',
    price: 4500.00,
    stock_quantity: 10,
    is_featured: true,
    image_url: 'https://images.unsplash.com/photo-1581092160562-40aa08e78837'
});

const addProduct = (token) => {
    const options = {
        hostname: 'localhost',
        port: 5000,
        path: '/api/v1/products',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': productData.length,
            'Authorization': `Bearer ${token}`
        }
    };

    const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
            console.log('--- Add Product Response ---');
            console.log(`Status: ${res.statusCode}`);
            console.log(body);
            process.exit();
        });
    });

    req.on('error', (e) => {
        console.error('Error adding product:', e.message);
        process.exit(1);
    });

    req.write(productData);
    req.end();
};

const loginReq = http.request(loginOptions, (res) => {
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => {
        const response = JSON.parse(body);
        if (response.success && response.token) {
            console.log('Login Successful, Adding Product...');
            addProduct(response.token);
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
