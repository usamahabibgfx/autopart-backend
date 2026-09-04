const mysql = require('mysql2/promise');
const fs = require('fs');

async function exportCategories() {
  try {
    const connection = await mysql.createConnection({
      host: '127.0.0.1',
      user: 'root',
      password: '',
      database: 'bestautopart'
    });

    const [rows] = await connection.execute('SELECT * FROM categories');
    
    if (rows.length === 0) {
      console.log('No categories found.');
      process.exit(0);
    }

    let sql = 'INSERT INTO categories (`id`, `name`, `name_ar`, `slug`, `image_url`, `description`, `parent_id`, `type`, `level`, `order_index`, `is_active`, `brand_names`, `created_at`, `updated_at`) VALUES \n';
    
    const values = rows.map(row => {
      const escape = (val) => {
        if (val === null) return 'NULL';
        if (typeof val === 'number') return val;
        // escape single quotes
        return "'" + String(val).replace(/'/g, "''").replace(/\\/g, "\\\\") + "'";
      };
      
      return `(${row.id}, ${escape(row.name)}, ${escape(row.name_ar)}, ${escape(row.slug)}, ${escape(row.image_url)}, ${escape(row.description)}, ${row.parent_id === null ? 'NULL' : row.parent_id}, ${escape(row.type)}, ${row.level}, ${row.order_index}, ${row.is_active}, ${escape(row.brand_names)}, ${escape(row.created_at ? row.created_at.toISOString().slice(0, 19).replace('T', ' ') : null)}, ${escape(row.updated_at ? row.updated_at.toISOString().slice(0, 19).replace('T', ' ') : null)})`;
    });

    sql += values.join(',\n') + ' ON DUPLICATE KEY UPDATE name=VALUES(name), name_ar=VALUES(name_ar), slug=VALUES(slug), image_url=VALUES(image_url), description=VALUES(description), parent_id=VALUES(parent_id), type=VALUES(type), level=VALUES(level), order_index=VALUES(order_index), is_active=VALUES(is_active), brand_names=VALUES(brand_names);\n';

    fs.writeFileSync('local_categories_export.sql', sql);
    console.log('Exported successfully to local_categories_export.sql');
    process.exit(0);
  } catch (error) {
    console.error('Error exporting:', error);
    process.exit(1);
  }
}

exportCategories();
