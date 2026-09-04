const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.SMTP_EMAIL,
        pass: process.env.SMTP_PASSWORD
    }
});

/**
 * Sends a transactional email.
 * @param {string} to - Recipient email.
 * @param {string} subject - Email subject.
 * @param {string} html - HTML content of the email.
 * @param {Array} attachments - Optional attachments.
 */
exports.sendEmail = async (to, subject, html, attachments = []) => {
    try {
        const mailOptions = {
            from: `"Best Signature Auto Parts" <${process.env.SMTP_EMAIL}>`,
            to,
            subject,
            html,
            attachments
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent: ' + info.response);
        return info;
    } catch (error) {
        console.error('Error sending email:', error);
        throw error;
    }
};

/**
 * Generates an order confirmation email template.
 */
exports.orderConfirmationTemplate = (order, locale = 'en') => {
    const isArabic = locale === 'ar';
    const title = isArabic ? `تأكيد الطلب #${order.id}` : `Order Confirmation #${order.id}`;
    const message = isArabic 
        ? `شكراً لتسوقك معنا. تم تأكيد طلبك بنجاح.` 
        : `Thank you for shopping with us. Your order has been successfully confirmed.`;
    
    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee;">
            <h2 style="color: #333;">${title}</h2>
            <p>${message}</p>
            <hr />
            <p><strong>Total Amount:</strong> AED ${order.final_amount}</p>
            <p><strong>Payment Method:</strong> ${order.payment_method}</p>
            <br />
            <p>Best regards,<br />Best Signature New Auto Spare Parts</p>
        </div>
    `;
};
