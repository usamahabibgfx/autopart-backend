const db = require('../config/db');
const nodemailer = require('nodemailer');

// Helper function to send email notification
const sendEmailNotification = async ({ name, email, countryCode, phone, subject, message }) => {
    const fullPhone = phone ? `${countryCode || ''} ${phone}` : 'Not provided';

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.SMTP_EMAIL,
            pass: process.env.SMTP_PASSWORD
        }
    });

    const mailOptions = {
        from: `"Best Signature Auto Parts - Contact Form" <${process.env.SMTP_EMAIL}>`,
        to: process.env.RECEIVER_EMAIL || process.env.SMTP_EMAIL,
        replyTo: email,
        subject: `New Form Submission Recieved : ${subject} - from ${name}`,
        html: `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                <div style="background: linear-gradient(135deg, #1a3a3c 0%, #2d6a5a 50%, #5bb377 100%); padding: 30px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 22px;">New Contact Form Submission</h1>
                    <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0; font-size: 14px;">From bestsignatureautoparts.com</p>
                </div>
                <div style="padding: 30px; background-color: #ffffff;">
                    <h3 style="color: #0f172a; border-bottom: 2px solid #f1f5f9; padding-bottom: 10px; margin-top: 0;">Contact Details</h3>
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr>
                            <td style="padding: 10px 0; font-weight: 600; color: #64748b; width: 100px;">Name:</td>
                            <td style="padding: 10px 0; color: #0f172a; font-weight: 500;">${name}</td>
                        </tr>
                        <tr>
                            <td style="padding: 10px 0; font-weight: 600; color: #64748b;">Email:</td>
                            <td style="padding: 10px 0;"><a href="mailto:${email}" style="color: #2d6a5a; text-decoration: none;">${email}</a></td>
                        </tr>
                        <tr>
                            <td style="padding: 10px 0; font-weight: 600; color: #64748b;">Phone:</td>
                            <td style="padding: 10px 0; color: #0f172a;">${fullPhone}</td>
                        </tr>
                        <tr>
                            <td style="padding: 10px 0; font-weight: 600; color: #64748b;">Subject:</td>
                            <td style="padding: 10px 0; color: #0f172a; font-weight: 500;">${subject}</td>
                        </tr>
                    </table>
                    <h3 style="color: #0f172a; border-bottom: 2px solid #f1f5f9; padding-bottom: 10px; margin-top: 25px;">Message</h3>
                    <p style="color: #334155; line-height: 1.7; white-space: pre-wrap; background: #f8fafc; padding: 16px; border-radius: 8px; border-left: 4px solid #5bb377;">${message}</p>
                </div>
                <div style="background-color: #0f172a; padding: 18px; text-align: center;">
                    <p style="color: #94a3b8; margin: 0; font-size: 12px;">This email was sent from the Best Signature Auto Parts Contact Form</p>
                </div>
            </div>
        `
    };

    await transporter.sendMail(mailOptions);
};

/**
 * @desc    Save contact form submission
 * @route   POST /api/v1/contact
 * @access  Public
 */
exports.submitContactForm = async (req, res) => {
    try {
        const { name, email, countryCode, phone, subject, message } = req.body;

        // Validate required fields
        if (!name || !email || !subject || !message) {
            return res.status(400).json({
                success: false,
                message: 'Please fill in all required fields'
            });
        }

        // Send email first — must succeed
        await sendEmailNotification({ name, email, countryCode, phone, subject, message });

        // Save to database only after email sent successfully
        await db.query(
            `INSERT INTO contact_submissions (name, email, country_code, phone, subject, message) VALUES (?, ?, ?, ?, ?, ?)`,
            [name, email, countryCode || '+971', phone || '', subject, message]
        );

        res.status(200).json({
            success: true,
            message: 'Your message has been sent successfully! We will get back to you soon.'
        });

    } catch (error) {
        console.error('Contact form error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send message. Please try again later.'
        });
    }
};

/**
 * @desc    Get all contact submissions
 * @route   GET /api/v1/contact
 * @access  Private/Admin
 */
exports.getAllContacts = async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT * FROM contact_submissions ORDER BY created_at DESC'
        );

        res.status(200).json({
            success: true,
            count: rows.length,
            data: rows
        });
    } catch (error) {
        console.error('Error fetching contacts:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch contact submissions'
        });
    }
};

/**
 * @desc    Update contact submission status
 * @route   PUT /api/v1/contact/:id/status
 * @access  Private/Admin
 */
exports.updateContactStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const validStatuses = ['new', 'read', 'replied', 'closed'];

        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status'
            });
        }

        await db.query(
            'UPDATE contact_submissions SET status = ? WHERE id = ?',
            [status, req.params.id]
        );

        res.status(200).json({
            success: true,
            message: 'Status updated'
        });
    } catch (error) {
        console.error('Error updating status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update status'
        });
    }
};

/**
 * @desc    Delete a contact submission
 * @route   DELETE /api/v1/contact/:id
 * @access  Private/Admin
 */
exports.deleteContact = async (req, res) => {
    try {
        await db.query('DELETE FROM contact_submissions WHERE id = ?', [req.params.id]);

        res.status(200).json({
            success: true,
            message: 'Submission deleted'
        });
    } catch (error) {
        console.error('Error deleting submission:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete submission'
        });
    }
};
