# Best Seller Badge System

## Overview
This system automatically assigns "Best Seller" badges to products based on actual sales data from the last 30 days. Products with the highest sales volume receive the badge without any manual intervention.

## How It Works

### 1. Database Structure
- A new column `is_best_seller` (TINYINT) has been added to the `products` table
- This column is automatically updated by the calculation script
- Values: `1` = Best Seller, `0` = Not a Best Seller

### 2. Calculation Logic
The system identifies best sellers by:
- Analyzing order data from the last 30 days
- Calculating total quantity sold per product
- Excluding cancelled and refunded orders
- Only considering active products
- Selecting the top 10 products by sales volume

### 3. Automatic Updates
Run the update script to recalculate best sellers:

```bash
cd backend
node scripts/updateBestSellers.js
```

**Recommended Schedule:** Run this script daily via cron job

#### Setting up a Cron Job (Linux/Mac):
```bash
# Edit crontab
crontab -e

# Add this line to run daily at midnight
0 0 * * * cd /path/to/BEST SIGNATURE/backend && node scripts/updateBestSellers.js >> /var/log/best-sellers.log 2>&1
```

#### Setting up Task Scheduler (Windows):
1. Open Task Scheduler
2. Create Basic Task
3. Set trigger: Daily at midnight
4. Action: Start a program
5. Program: `node`
6. Arguments: `scripts/updateBestSellers.js`
7. Start in: `D:\BEST SIGNATURE\backend`

## Installation

### Step 1: Run Database Migration
```bash
cd backend
node migrations/add-best-seller-column.js
```

### Step 2: Initial Calculation
```bash
node scripts/updateBestSellers.js
```

## API Usage

### Filter Products by Best Seller
```javascript
// Get all best seller products
GET /api/v1/products?is_best_seller=1

// Combine with other filters
GET /api/v1/products?is_best_seller=1&category=refrigerators
```

## Frontend Display

### ProductCard Component
The "Best Seller" badge automatically appears on product cards when `product.is_best_seller === 1`

**Badge Styling:**
- Color: Dark Blue (#1a237e)
- Position: Top-left of product image
- Text: "Best Seller"

### ProductCardPromotion Component
Same badge system applies to promotional cards

## Customization

### Change Number of Best Sellers
Edit `backend/scripts/updateBestSellers.js`:
```javascript
// Line 28 - Change LIMIT value
LIMIT 10  // Change to desired number (e.g., LIMIT 20)
```

### Change Time Period
Edit `backend/scripts/updateBestSellers.js`:
```javascript
// Line 24 - Change INTERVAL value
WHERE o.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
// Change to: INTERVAL 60 DAY, INTERVAL 7 DAY, etc.
```

### Change Badge Color
Edit `frontend/src/components/shared/ProductCard/ProductCard.module.css`:
```css
.bestSellerTag {
    background: #1a237e; /* Change this color */
}
```

## Monitoring

### View Current Best Sellers
```sql
SELECT id, name, is_best_seller 
FROM products 
WHERE is_best_seller = 1;
```

### Check Sales Data
```sql
SELECT 
    p.name,
    SUM(oi.quantity) as total_sold,
    COUNT(DISTINCT o.id) as order_count
FROM order_items oi
JOIN orders o ON oi.order_id = o.id
JOIN products p ON oi.product_id = p.id
WHERE o.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY oi.product_id
ORDER BY total_sold DESC
LIMIT 10;
```

## Troubleshooting

### No Best Sellers Showing
1. Check if migration ran successfully
2. Verify there are orders in the database
3. Run the update script manually
4. Check script output for errors

### Badge Not Displaying
1. Verify `is_best_seller = 1` in database
2. Check browser console for errors
3. Clear browser cache
4. Verify CSS is loaded correctly

## Technical Details

### Files Modified/Created
- `backend/migrations/add-best-seller-column.js` - Database migration
- `backend/scripts/updateBestSellers.js` - Calculation script
- `backend/models/product.model.js` - Added filter support
- `frontend/src/components/shared/ProductCard/ProductCard.tsx` - Badge display
- `frontend/src/components/shared/ProductCard/ProductCard.module.css` - Badge styling
- `frontend/src/components/shared/ProductCardPromotion/ProductCardPromotion.tsx` - Badge display
- `frontend/src/components/shared/ProductCardPromotion/ProductCardPromotion.module.css` - Badge styling

### Dependencies
- Existing order and order_items tables
- MySQL/MariaDB database
- Node.js backend
- React frontend

## Future Enhancements
- Admin dashboard to manually override best sellers
- Multiple badge tiers (Top 3, Top 10, etc.)
- Category-specific best sellers
- Real-time updates via webhooks
- Analytics dashboard for sales trends
