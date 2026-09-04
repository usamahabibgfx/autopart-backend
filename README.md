# Best Signature Auto Parts Backend

A production-ready Node.js backend for a B2B ecommerce platform specializing in auto spare parts.

## Tech Stack
- **Node.js** & **Express.js**
- **MySQL** (using `mysql2/promise` for async/await)
- **JWT** for Authentication
- **Bcryptjs** for Password Hashing
- **Express-validator** for Input Validation
- **CORS** for Cross-Origin Resource Sharing
- **MVC Architecture**

## Features
- **Authentication**: User registration, login, and profile management with JWT.
- **Roles**: Admin and User roles with protected routes.
- **Product Management**: Slug-based navigation, filtering (category, brand, price), search, and pagination.
- **Category & Brand Modules**: Full CRUD for admins, slug-based fetching for clients.
- **Cart System**: Persistent database-backed cart for authenticated users.
- **Order Management**: Transactional order placement, stock reduction, and VAT calculation (UAE standard).
- **Reward Points**: Earn points on purchases based on order value.
- **Wishlist**: Add/remove products to personal wishlist.
- **Security**: SQL injection protection (prepared statements), centralized error handling, and secure password storage.

## Installation

1. **Clone the repository**
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Database Setup**:
   - Create a MySQL database (e.g., `bestautopart`).
   - Import the `schema.sql` file into your database.
4. **Environment Variables**:
   - Configure your `.env` file with your database credentials and JWT secret.
5. **Start the server**:
   ```bash
   # For development
   npm start
   ```

## API Documentation (v1)

### Auth
- `POST /api/v1/auth/register` - Register a new user
- `POST /api/v1/auth/login` - Login and get token
- `GET /api/v1/auth/me` - Get current user profile

### Products
- `GET /api/v1/products` - Get all products (with filters & pagination)
- `GET /api/v1/products/:id` - Get product details
- `POST /api/v1/products` - Create product (Admin)
- `PUT /api/v1/products/:id` - Update product (Admin)
- `DELETE /api/v1/products/:id` - Delete product (Admin)

### Categories & Brands
- `GET /api/v1/categories` - Get all categories
- `GET /api/v1/brands` - Get all brands

### Cart
- `GET /api/v1/cart` - View cart
- `POST /api/v1/cart` - Add item to cart
- `PUT /api/v1/cart/:id` - Update quantity
- `DELETE /api/v1/cart/:id` - Remove item

### Orders
- `POST /api/v1/orders` - Place order (from cart)
- `GET /api/v1/orders` - View my orders
- `GET /api/v1/orders/:id` - View order details
- `PUT /api/v1/orders/:id` - Update order status (Admin)

### Wishlist
- `GET /api/v1/wishlist` - View wishlist
- `POST /api/v1/wishlist` - Add to wishlist
- `DELETE /api/v1/wishlist/:productId` - Remove from wishlist
