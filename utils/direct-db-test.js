const db = require('../config/db');
const Product = require('../models/product.model');

const test = async () => {
    try {
        console.log('--- Direct DB Test ---');
        const data = {
            name: 'Direct Test Product',
            price: 99.99,
            stock_quantity: 5,
            image_url: 'http://example.com/img.jpg'
        };
        const id = await Product.create(data);
        console.log('Success! Product ID:', id);
        process.exit(0);
    } catch (error) {
        console.error('Direct Test Failed:');
        console.error(error);
        process.exit(1);
    }
};

test();
