const nodemailer = require('nodemailer');
const dns = require('dns');
const dnsp = require('dns').promises;

// SMTP provider is configurable via env so we can switch between Gmail,
// Hostinger, etc. without code changes.
//   SMTP_HOST     e.g. smtp.hostinger.com  (default smtp.gmail.com)
//   SMTP_PORT     465 (SSL) or 587 (STARTTLS) — default 587
//   SMTP_EMAIL    full mailbox address, also used as the From address
//   SMTP_PASSWORD mailbox password / app password
const SMTP_HOSTNAME = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_SECURE = SMTP_PORT === 465; // implicit TLS on 465, STARTTLS otherwise
const SMTP_CONFIGURED = Boolean(process.env.SMTP_EMAIL && process.env.SMTP_PASSWORD);

// Some hosts (e.g. Render) can't route IPv6 to the SMTP server (ENETUNREACH).
// Force Node to prefer IPv4 results.
try { dns.setDefaultResultOrder('ipv4first'); } catch (_) { /* older Node — ignore */ }

// Belt-and-suspenders: pre-resolve the SMTP host to an IPv4 address at startup
// and connect to that IP directly. SMTPConnection's `family`/`lookup` options
// are not always honored on Render, so we bypass runtime DNS entirely.
let cachedSmtpHost = null;
let smtpHostResolveAt = 0;
const SMTP_HOST_TTL_MS = 30 * 60 * 1000; // re-resolve every 30 minutes
async function getSmtpHost() {
    const now = Date.now();
    if (cachedSmtpHost && (now - smtpHostResolveAt) < SMTP_HOST_TTL_MS) return cachedSmtpHost;
    try {
        const ips = await dnsp.resolve4(SMTP_HOSTNAME);
        if (ips && ips.length) {
            cachedSmtpHost = ips[Math.floor(Math.random() * ips.length)];
            smtpHostResolveAt = now;
            console.log(`[EMAIL] Resolved ${SMTP_HOSTNAME} → ${cachedSmtpHost} (IPv4)`);
            return cachedSmtpHost;
        }
    } catch (e) {
        console.error(`[EMAIL] IPv4 resolve failed for ${SMTP_HOSTNAME}:`, e.message);
    }
    return SMTP_HOSTNAME;
}

// Kick off the initial resolution only when email is configured.
if (SMTP_CONFIGURED) getSmtpHost().catch(() => {});

// Mobile-responsive overrides injected into EVERY outgoing email. On phones the
// fixed 600px cards must go full width with no card border/radius/shadow/margin,
// and the chunky desktop side padding is reduced so content isn't cramped.
// Targets both `.container` wrappers and any inline 600px table/div wrapper.
const RESPONSIVE_EMAIL_STYLE = `
<style>
@media only screen and (max-width:600px){
    .container,
    table[width="600"],
    [style*="max-width: 600px"],
    [style*="max-width:600px"]{
        width:100% !important;
        max-width:100% !important;
        border:0 !important;
        border-radius:0 !important;
        box-shadow:none !important;
        margin:0 !important;
    }
    [style*="padding: 40px"]{ padding:24px 18px !important; }
    [style*="padding:40px 45px"],
    [style*="padding:40px 30px"],
    [style*="padding: 40px 30px"]{ padding:24px 18px !important; }
    [style*="padding:30px 40px"]{ padding:22px 18px !important; }
    body, .email-bg, table[style*="padding:40px 0"]{ padding-left:0 !important; padding-right:0 !important; }
    .cta-btn{ display:block !important; width:100% !important; box-sizing:border-box !important; }
    /* Footer: full width, no card border on mobile */
    .email-footer{ width:100% !important; border:0 !important; border-radius:0 !important; }
    .email-footer-pad{ padding:24px 18px !important; }
    /* Content cells: shrink chunky desktop side padding so content fills width */
    .content-pad{ padding-left:18px !important; padding-right:18px !important; padding-top:24px !important; padding-bottom:24px !important; }
}
</style>`;

// Put the responsive overrides inside <head> so Gmail (incl. the Android/Samsung
// app) keeps them — Gmail strips <style> that sits loose in the body. Templates
// that ship a full doc get the style appended to <head>; bare-fragment templates
// (no <head>) get wrapped in a minimal doc with a viewport meta + the style.
const injectResponsive = (html) => {
    if (typeof html !== 'string' || !html) return html;
    if (html.includes('</head>')) return html.replace('</head>', `${RESPONSIVE_EMAIL_STYLE}</head>`);
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${RESPONSIVE_EMAIL_STYLE}</head><body style="margin:0;padding:0;">${html}</body></html>`;
};

const createTransporter = () => {
    // Sync access to the most recently cached IP. Falls back to the hostname
    // on the very first request before resolution completes (rare; the
    // top-level getSmtpHost() call above usually resolves before any email).
    const host = cachedSmtpHost || SMTP_HOSTNAME;
    const transporter = nodemailer.createTransport({
        host,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        requireTLS: !SMTP_SECURE, // STARTTLS upgrade required on port 587
        family: 4,
        tls: {
            // We're connecting by IP, so verify the cert against the real hostname
            servername: SMTP_HOSTNAME,
            rejectUnauthorized: false
        },
        auth: {
            user: process.env.SMTP_EMAIL,
            pass: process.env.SMTP_PASSWORD
        },
        // Fail fast instead of letting requests hang for the platform default
        connectionTimeout: 15000,
        greetingTimeout: 10000,
        socketTimeout: 20000
    });

    // Auto-inject the mobile-responsive <style> into every email's HTML so all
    // templates render full-width and border-less on phones without per-template edits.
    const originalSendMail = transporter.sendMail.bind(transporter);
    transporter.sendMail = (options, callback) => {
        if (options && options.html) options = { ...options, html: injectResponsive(options.html) };
        return originalSendMail(options, callback);
    };

    return transporter;
};

// Inline logo as a `cid:` attachment. Email clients (Gmail, Outlook) don't render
// .webp, so a referenced webp URL shows as a broken image. The PNG attachment
// renders reliably everywhere. Reference it in HTML via <img src="cid:bestsignatureEmailLogo">.
const path = require('path');
const fs = require('fs');

// Resolve an asset across deploy layouts. On prod only the backend is deployed,
// so the sibling `frontend/public` path doesn't exist — fall back to the copy
// bundled in backend/assets. Returns the first existing path, or null.
const resolveAsset = (...candidates) => {
    for (const p of candidates) {
        try { if (p && fs.existsSync(p)) return p; } catch (_) { /* ignore */ }
    }
    return null;
};

const LOGO_EN_PATH = resolveAsset(
    path.join(__dirname, '../../_remote_frontend/public/assets/best-signature-logo.png'),
    path.join(__dirname, '../../_remote_frontend/public/assets/best-signature-logo.png')
);
const LOGO_AR_PATH = resolveAsset(
    path.join(__dirname, '../../_remote_frontend/public/assets/best-signature-logo.png'),
    path.join(__dirname, '../../_remote_frontend/public/assets/best-signature-logo.png'),
    path.join(__dirname, '../../_remote_frontend/public/assets/best-signature-logo.png')
);
// Editorial hero photo at the top of every design-system email card — per language.
// Arabic → email-hero-ar.png, English → email-hero-en.png. Each falls back to the
// shared email-hero.png (then the frontend copy) if the locale-specific file is absent.
const HERO_EN_PATH = resolveAsset(
    path.join(__dirname, '../assets/email-hero-en.png'),
    path.join(__dirname, '../assets/email-hero.png'),
    path.join(__dirname, '../../frontend/public/assets/email-hero.png')
);
const HERO_AR_PATH = resolveAsset(
    path.join(__dirname, '../assets/email-hero-ar.png'),
    path.join(__dirname, '../assets/email-hero.png'),
    path.join(__dirname, '../../frontend/public/assets/email-hero.png')
);

// (Logo cid attachment is provided per-locale by dsEmailAttachments() below.)

// Resolve a stored product image to an absolute URL email clients can fetch.
// Handles full URLs, data URIs, protocol-relative, /assets, Windows backslashes,
// public/ prefixes and bare uploads paths. Mirrors abandonedCart/stockNotifications
// so every email renders the same image. Returns '' when there's nothing usable
// (callers then fall back to a neutral placeholder, never a broken image).
const EMAIL_MEDIA_BASE = (process.env.MEDIA_BASE_URL || 'https://api.bestsignatureautoparts.com').replace(/\/+$/, '');
const absolutizeEmailImage = (raw) => {
    if (!raw || typeof raw !== 'string') return '';
    let s = raw.trim().replace(/\\/g, '/');
    if (!s) return '';
    if (/^data:/i.test(s)) return s;
    s = s.replace(/^(\/)?public\//, '');
    if (/^https?:\/\//i.test(s)) return s.replace(/ /g, '%20');
    if (s.startsWith('//')) return `https:${s}`.replace(/ /g, '%20');
    if (s.startsWith('/assets/')) return `https://bestsignatureautoparts.com${s}`.replace(/ /g, '%20');
    if (!s.startsWith('/') && /^(brands|products|slides|posters)\//.test(s)) s = `uploads/${s}`;
    if (!s.startsWith('/')) s = `/${s}`;
    return `${EMAIL_MEDIA_BASE}${s}`.replace(/ /g, '%20');
};

// --- Email localization helpers ---
// Emails are sent in the recipient's chosen site language (en | ar).
const isAr = (locale) => String(locale || 'en').toLowerCase().startsWith('ar');
// dir/text-align to inject on the email body so Arabic renders right-to-left.
const dirAttr = (ar) => (ar ? 'rtl' : 'ltr');
const alignStart = (ar) => (ar ? 'right' : 'left');

// Build a localized variant label for an order line, e.g. "Color: Red / Size: Large"
// (Arabic uses the *_ar fields when present). Handles both shapes the order items can take:
//  • variant_options as an array of {name,name_ar,value,value_ar} — cart-sourced emails
//    (order confirmation): full, localized "Name: Value" pairs.
//  • variant_options as an options_signature string "optionId:value|optionId:value" —
//    order-sourced emails (status updates): only the readable values are available, so we
//    strip the leading "id:" and join the values.
// Falls back to custom_label (customizable products). Returns '' when there's nothing to show.
const buildVariantLabel = (item, ar) => {
    const opts = item && item.variant_options;
    if (Array.isArray(opts) && opts.length > 0) {
        return opts.map(o => {
            const n = (ar && o.name_ar) ? o.name_ar : (o.name || '');
            const v = (ar && o.value_ar) ? o.value_ar : (o.value || '');
            return n ? `${n}: ${v}` : v;
        }).filter(Boolean).join(' / ');
    }
    if (typeof opts === 'string' && opts.trim()) {
        return opts.split('|')
            .map(part => {
                const idx = part.indexOf(':');
                return (idx !== -1 ? part.slice(idx + 1) : part).trim();
            })
            .filter(Boolean)
            .join(' / ');
    }
    return (item && item.custom_label) ? String(item.custom_label).trim() : '';
};

// ============================================================================
// Best Signature Design System email shell (editorial redesign)
// ----------------------------------------------------------------------------
// Every transactional email shares one shell: warm #ffffff canvas → white card
// with an 18px radius → red→blue 4px signature bar → centered logo → editorial
// hero photo → content → attached #ffffff footer (logo, address, contacts,
// socials). Type is Spectral (serif headlines) + Public Sans (body) in English,
// Alexandria in Arabic. Logo + hero are inlined as cid: attachments so Gmail/
// Outlook render them reliably. See `frontend/test/Best Signature Design System`.
// ============================================================================

// Inline font stacks. Email clients that can't load the web font fall back to
// the platform serif/sans, which is expected and on-brand.
const DS_SANS = "'Public Sans','Segoe UI',Helvetica,Arial,sans-serif";
const DS_SERIF = "'Spectral',Georgia,'Times New Roman',serif";
// Spectral/Public Sans have no Arabic glyphs — Alexandria covers both roles.
const DS_SANS_AR = "'Alexandria','Segoe UI',Tahoma,Arial,sans-serif";
const DS_SERIF_AR = "'Alexandria','Segoe UI',Tahoma,Arial,sans-serif";

// <link> for the right web fonts per language.
const dsFontLink = (ar) => (ar
    ? `<link href="https://fonts.googleapis.com/css2?family=Alexandria:wght@400;500;600;700;800&display=swap" rel="stylesheet">`
    : `<link href="https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,500;0,600;0,700;1,500&family=Public+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">`);

// cid attachments every DS email needs: the (locale-aware) logo + the hero photo.
// Both header and footer reference the single `bestsignatureEmailLogo` cid.
const dsEmailAttachments = (ar) => {
    const out = [];
    const logoPath = (ar && LOGO_AR_PATH) ? LOGO_AR_PATH : LOGO_EN_PATH;
    if (logoPath) out.push({ filename: 'bestsignature-logo.png', path: logoPath, cid: 'bestsignatureEmailLogo' });
    const heroPath = ar ? HERO_AR_PATH : HERO_EN_PATH;
    if (heroPath) out.push({ filename: 'email-hero.png', path: heroPath, cid: 'bestsignatureEmailHero' });
    return out;
};

// Outlook's Word engine ignores CSS width/height on images and paints them at
// natural PNG size, so the logo must also carry HTML width/height attributes.
// Ratios match the shipped assets: EN 883x282, AR 4260x903.
const dsLogoAttrs = (ar, height) => {
    const ratio = ar ? 4260 / 903 : 883 / 282;
    return `width="${Math.round(height * ratio)}" height="${height}"`;
};

// The attached footer card (logo · address · contacts · copyright · socials),
// mirrored for RTL. Pulls the live site URL from FRONTEND_URL.
const dsFooter = (ar) => {
    const SITE = process.env.FRONTEND_URL || 'https://bestsignatureautoparts.com';
    const sans = ar ? DS_SANS_AR : DS_SANS;
    const dir = ar ? 'rtl' : 'ltr';
    const endAlign = ar ? 'left' : 'right'; // contacts / socials sit at the line end
    const company = ar ? 'ماريوت لتجارة معدات المطابخ ش.ذ.م.م' : 'Best Signature New Auto Spare Parts Trading LLC';
    const city = ar ? 'دبي، الإمارات العربية المتحدة' : 'Maliha Road - Industrial Area 12 - Sharjah, UAE';
    const rights = ar
        ? `© ${new Date().getFullYear()} ماريوت لمعدات المطابخ. جميع الحقوق محفوظة.`
        : `© ${new Date().getFullYear()} Best Signature New Auto Spare Parts. All rights reserved.`;
    const activity = ar
        ? 'لقد تلقيت هذا البريد الإلكتروني نتيجة لنشاط على حسابك في متجر ماريوت.'
        : 'You are receiving this email because of activity on your Best Signature Auto Parts account.';
    return `
<table role="presentation" width="600" class="container" cellpadding="0" cellspacing="0" align="center" style="max-width:600px;width:100%;margin:0 auto;">
  <tr><td style="padding:0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="background:#ffffff;border:1px solid #e9e7e2;border-top:0;border-radius:0 0 18px 18px;overflow:hidden;">
      <tr><td style="font-size:0;line-height:0;padding:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="38%" style="background:#e62127;height:4px;line-height:4px;font-size:0;">&nbsp;</td><td style="background:#19489D;height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr></table></td></tr>
      <tr><td class="content-pad" style="padding:30px 48px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:top;">
            <img src="cid:bestsignatureEmailLogo" alt="Best Signature New Auto Spare Parts" ${dsLogoAttrs(ar, 28)} style="height:28px;width:auto;display:block;margin-bottom:14px;border:0;">
            <p style="margin:0 0 2px;font-family:${sans};font-size:12px;line-height:1.7;color:#17181c;">${company}</p>
            <p style="margin:0;font-family:${sans};font-size:12px;line-height:1.7;color:#17181c;">${city}</p>
          </td>
          <td align="${endAlign}" style="vertical-align:top;font-family:${sans};font-size:12px;line-height:1.9;color:#17181c;" dir="ltr">
            <a href="tel:+971509967967" style="color:#17181c;text-decoration:none;"><img src="https://cdn-icons-png.flaticon.com/32/724/724664.png" alt="Phone" width="13" height="13" style="vertical-align:middle;margin-right:6px;border:0;">+971 50 996 7967</a><br>
            <a href="https://wa.me/971503114080" style="color:#17181c;text-decoration:none;"><img src="https://cdn-icons-png.flaticon.com/32/733/733585.png" alt="WhatsApp" width="12" height="12" style="vertical-align:middle;margin-right:6px;border:0;">+971 50 311 4080</a><br>
            <a href="mailto:support@bestsignatureautoparts.com" style="color:#1488c0;text-decoration:none;font-weight:600;">support@bestsignatureautoparts.com</a><br>
            <a href="${SITE}" style="color:#1488c0;text-decoration:none;font-weight:600;">www.bestsignatureautoparts.com</a>
          </td>
        </tr></table>
        <div style="border-top:1px solid #ecedef;margin:20px 0 16px;"></div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td class="ft-copy" style="font-family:${sans};font-size:11px;color:#17181c;">${rights}</td>
          <td class="ft-social" align="${endAlign}">
            <a href="https://www.facebook.com/bestsignatureautoparts" style="text-decoration:none;margin:0 2px;"><img src="https://cdn-icons-png.flaticon.com/32/145/145802.png" alt="Facebook" width="18" height="18" style="opacity:1;border:0;"></a>
            <a href="https://www.instagram.com/bestsignatureautoparts/" style="text-decoration:none;margin:0 2px;"><img src="https://cdn-icons-png.flaticon.com/32/2111/2111463.png" alt="Instagram" width="18" height="18" style="opacity:1;border:0;"></a>
            <a href="https://x.com/Best SignatureUae" style="text-decoration:none;margin:0 2px;"><img src="https://cdn-icons-png.flaticon.com/32/5969/5969020.png" alt="X" width="18" height="18" style="opacity:1;border:0;"></a>
            <a href="https://www.youtube.com/channel/UCUCWktTJNpRzUEJ58JHLu_g" style="text-decoration:none;margin:0 2px;"><img src="https://cdn-icons-png.flaticon.com/32/1384/1384060.png" alt="YouTube" width="18" height="18" style="opacity:1;border:0;"></a>
            <a href="https://www.tiktok.com/@bestsignatureautoparts" style="text-decoration:none;margin:0 2px;"><img src="https://cdn-icons-png.flaticon.com/32/3046/3046121.png" alt="TikTok" width="18" height="18" style="opacity:1;border:0;"></a>
            <a href="https://www.linkedin.com/company/bestsignatureautoparts" style="text-decoration:none;margin:0 2px;"><img src="https://cdn-icons-png.flaticon.com/32/145/145807.png" alt="LinkedIn" width="18" height="18" style="opacity:1;border:0;"></a>
            <a href="https://www.pinterest.com/bestsignatureautoparts/" style="text-decoration:none;margin:0 2px;"><img src="https://cdn-icons-png.flaticon.com/32/145/145808.png" alt="Pinterest" width="18" height="18" style="opacity:1;border:0;"></a>
          </td>
        </tr></table>
      </td></tr>
    </table>
    <p style="margin:16px 4px 0;font-family:${sans};font-size:11px;line-height:1.6;color:#17181c;text-align:center;">${activity}</p>
  </td></tr>
</table>`;
};

// Wrap a body fragment (the per-email content) in the full DS document: head +
// fonts + card + signature bar + logo + hero + content cell + attached footer.
//   ar        — Arabic (RTL) when true
//   preheader — hidden inbox-preview line
//   hero      — include the editorial hero photo (default true)
//   content   — the inner HTML for the content cell (built per email)
const dsShell = ({ ar = false, preheader = '', hero = true, content = '' }) => {
    const dir = ar ? 'rtl' : 'ltr';
    const align = ar ? 'right' : 'left';
    const heroRow = hero
        ? `<tr><td style="padding:14px 0 0;font-size:0;line-height:0;"><img src="cid:bestsignatureEmailHero" alt="Best Signature — professional auto spare parts" width="600" style="display:block;width:100%;height:auto;border:0;"></td></tr>`
        : '';
    return `<!DOCTYPE html>
<html lang="${ar ? 'ar' : 'en'}" dir="${dir}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting"><title>Best Signature</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${dsFontLink(ar)}
<style>
@media only screen and (max-width:600px){.container{width:100%!important;max-width:100%!important;}.content-pad{padding-left:26px!important;padding-right:26px!important;}.cta-btn{display:block!important;}.ft-copy{display:block!important;width:100%!important;text-align:center!important;font-size:10px!important;white-space:nowrap!important;padding-bottom:14px!important;}.ft-social{display:block!important;width:100%!important;text-align:center!important;}}
</style></head>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:42px 14px 0;"><tr><td align="center">
  <table role="presentation" width="600" class="container" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e9e7e2;border-radius:18px 18px 0 0;overflow:hidden;box-shadow:0 1px 2px rgba(23,24,28,.04),0 18px 48px rgba(23,24,28,.07);">
    <tr><td style="font-size:0;line-height:0;padding:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="38%" style="background:#e62127;height:4px;line-height:4px;font-size:0;">&nbsp;</td><td style="background:#19489D;height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr></table></td></tr>
    <tr><td align="center" style="padding:30px 30px 4px;"><img src="cid:bestsignatureEmailLogo" alt="Best Signature New Auto Spare Parts" ${dsLogoAttrs(ar, 34)} style="height:34px;width:auto;display:inline-block;border:0;"></td></tr>
    ${heroRow}
    <tr><td class="content-pad" dir="${dir}" style="padding:42px 48px 44px;text-align:${align};">
${content}
    </td></tr>
  </table>
  ${dsFooter(ar)}
</td></tr></table></body></html>`;
};

// A reusable dark pill CTA button matching the design system (#17181c, 9px radius).
const dsButton = (href, label, ar) => {
    const sans = ar ? DS_SANS_AR : DS_SANS;
    return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td align="center" style="border-radius:9px;background:#17181c;"><a href="${href}" class="cta-btn" style="display:inline-block;padding:15px 38px;font-family:${sans};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:9px;letter-spacing:.01em;">${label}</a></td></tr></table>`;
};

// (Legacy "Get in touch" footer removed — every email now uses the design-system
//  footer via dsShell()/dsFooter() above.)

// Verify SMTP connection on first use
const verifySmtpConnection = async () => {
    if (!SMTP_CONFIGURED) {
        console.log('[EMAIL] SMTP is not configured; skipping startup verification');
        return false;
    }
    console.log(`[EMAIL] SMTP_EMAIL: ${process.env.SMTP_EMAIL}`);
    console.log(`[EMAIL] SMTP_PASSWORD length: ${process.env.SMTP_PASSWORD?.length} chars`);
    try {
        const transporter = createTransporter();
        await transporter.verify();
        console.log('[EMAIL] ✅ SMTP connection verified successfully');
        return true;
    } catch (error) {
        console.error('[EMAIL] ❌ SMTP connection failed:', error.message);
        return false;
    }
};

/**
 * Sends a generic HTML email.
 * @param {string} to - Recipient email.
 * @param {string} subject - Email subject.
 * @param {string} html - HTML content of the email.
 */
const sendEmail = async (to, subject, html) => {
    try {
        const transporter = createTransporter();
        const mailOptions = {
            from: `"Best Signature Auto Parts" <${process.env.SMTP_EMAIL}>`,
            to,
            subject,
            html
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('[EMAIL] ✅ Generic email sent: ' + info.response);
        return info;
    } catch (error) {
        console.error('[EMAIL] ❌ Error sending generic email:', error);
        throw error;
    }
};

/**
 * Send a password reset email to the user
 * @param {string} toEmail - Recipient email
 * @param {string} userName - User's display name
 * @param {string} resetUrl - Full reset URL with token
 */
const sendPasswordResetEmail = async (toEmail, userName, resetUrl, locale = 'en') => {
    const transporter = createTransporter();
    const ar = isAr(locale);
    const SANS = ar ? DS_SANS_AR : DS_SANS;
    const SERIF = ar ? DS_SERIF_AR : DS_SERIF;
    const L = ar ? {
        subject: 'إعادة تعيين كلمة المرور — متجر ماريوت',
        preheader: 'أعد تعيين كلمة مرور ماريوت — الرابط صالح لمدة 15 دقيقة.',
        eyebrow: 'أمان الحساب',
        title: 'إعادة تعيين كلمة المرور',
        intro: 'تلقينا طلباً لإعادة تعيين كلمة المرور الخاصة بحسابك في ماريوت. اضغط الزر أدناه لاختيار كلمة مرور جديدة. هذا الرابط صالح لمدة 15 دقيقة.',
        cta: 'إعادة تعيين كلمة المرور',
        expiry: 'لأمانك، تنتهي صلاحية هذا الرابط خلال 15 دقيقة.',
        ignore: 'إذا لم تطلب إعادة تعيين كلمة المرور، فلا حاجة لأي إجراء — ستبقى كلمة مرورك كما هي.',
        fallback: 'إذا لم يعمل الزر، الصق هذا الرابط في متصفحك:',
        text: `مرحباً ${userName}،\n\nطلبت إعادة تعيين كلمة المرور لحسابك في متجر ماريوت.\n\nاضغط الرابط أدناه لتعيين كلمة مرور جديدة. ينتهي الرابط خلال 15 دقيقة.\n\n${resetUrl}\n\nإذا لم تطلب ذلك، تجاهل هذه الرسالة.\n\nفريق متجر ماريوت`
    } : {
        subject: 'Reset your password — Best Signature Auto Parts',
        preheader: 'Reset your Best Signature password — link valid for 15 minutes.',
        eyebrow: 'Account security',
        title: 'Reset your password',
        intro: 'We received a request to reset the password for your Best Signature account. Click the button below to choose a new one. This link is valid for 15 minutes.',
        cta: 'Reset my password',
        expiry: 'For your security, this link expires in 15 minutes.',
        ignore: "If you didn't request a password reset, no action is needed — your password will stay the same.",
        fallback: "If the button doesn't work, paste this link into your browser:",
        text: `Hi ${userName},\n\nYou requested a password reset for your Best Signature Auto Parts account.\n\nPlease click the link below to set a new password. This link will expire in 15 minutes.\n\n${resetUrl}\n\nIf you did not request this, please ignore this email and your password will remain unchanged.\n\nBest regards,\nBest Signature Auto Parts Team`
    };

    const content = `
<p style="margin:0 0 14px;font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#1488c0;">${L.eyebrow}</p>
<h1 style="margin:0 0 18px;font-family:${SERIF};font-size:34px;line-height:1.16;font-weight:600;letter-spacing:-.01em;color:#17181c;">${L.title}</h1>
<p style="margin:0 0 18px;font-family:${SANS};font-size:15px;line-height:1.65;color:#17181c;">${L.intro}</p>
<div style="height:6px;"></div>
${dsButton(resetUrl, L.cta, ar)}
<div style="height:24px;"></div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;"><tr><td style="background:#fff7ed;border-radius:10px;padding:13px 16px;">
  <p style="margin:0;font-family:${SANS};font-size:13px;font-weight:600;color:#9a3412;">${L.expiry}</p>
</td></tr></table>
<p style="margin:0 0 18px;font-family:${SANS};font-size:15px;line-height:1.65;color:#17181c;">${L.ignore}</p>
<div style="border-top:1px solid #ecedef;padding-top:18px;">
  <p style="margin:0 0 8px;font-family:${SANS};font-size:12px;color:#17181c;">${L.fallback}</p>
  <p style="margin:0;font-family:${SANS};font-size:12px;word-break:break-all;color:#1488c0;" dir="ltr">${resetUrl}</p>
</div>`;

    const mailOptions = {
        from: `"Best Signature Auto Parts" <${process.env.SMTP_EMAIL}>`,
        to: toEmail,
        subject: L.subject,
        text: L.text,
        html: dsShell({ ar, preheader: L.preheader, content }),
        attachments: dsEmailAttachments(ar)
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`[EMAIL] ✅ Password reset email sent to ${toEmail}`);
    } catch (error) {
        console.error(`[EMAIL] ❌ Failed to send password reset email to ${toEmail}:`, error.message);
        throw error;
    }
};

/**
 * Send an order confirmation email to the user (sent immediately after checkout)
 */
const sendOrderConfirmationEmail = async (toEmail, userName, orderId, finalAmount, orderItems = [], orderData = {}, locale = 'en') => {
    const transporter = createTransporter();
    const isAdminCopy = orderData.is_admin_copy === true;
    const ar = !isAdminCopy && isAr(locale); // admin back-office copy stays English

    const subtotalNum = Number(orderData.total_amount || 0);
    const vatNum = Number(orderData.vat_amount || 0);
    const deliveryNum = Number(orderData.delivery_charge || 0);
    const totalNum = Number(finalAmount || 0);
    // Combined discount (coupon + reward points), derived from the stored amounts so the
    // summary always reconciles:  items − discount + VAT + delivery = total.
    const discountNum = Math.max(0, subtotalNum - (totalNum - vatNum - deliveryNum));
    const subtotal = subtotalNum.toFixed(2);
    const vat = vatNum.toFixed(2);
    const delivery = deliveryNum.toFixed(2);
    const discount = discountNum.toFixed(2);
    const total = totalNum.toFixed(2);
    const date = new Date(orderData.created_at || Date.now()).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

    const billing = orderData.billing_details || {};
    const shipping = orderData.shipping_address || billing;
    const isPaid = (orderData.payment_status === 'paid' || orderData.payment_status === 'PAID');
    const isAdmin = orderData.is_admin_copy === true;
    const SITE = process.env.FRONTEND_URL || 'https://bestsignatureautoparts.com';
    // Locale-prefixed so the profile deep-link guard fires (not logged in →
    // /signin?redirectTo=… → returns to orders tab → download invoice).
    const orderSummaryUrl = `${SITE}/${ar ? 'ar' : 'en'}/profile?tab=yourOrders&orderId=${orderId}&view=summary`;

    const firstName = String(userName || '').split(' ')[0] || (ar ? 'عميلنا' : 'there');
    const SANS = ar ? DS_SANS_AR : DS_SANS;
    const SERIF = ar ? DS_SERIF_AR : DS_SERIF;
    const endAlign = ar ? 'left' : 'right'; // amounts / prices sit at the line end
    const padStart = ar ? 'right' : 'left';

    const L = ar ? {
        subjectPaid: `تم تأكيد الدفع — طلب #${orderId} — متجر ماريوت`,
        subjectNew: `تأكيد الطلب #${orderId} — متجر ماريوت`,
        preheader: `تم تأكيد الطلب #${orderId} — الإجمالي AED ${total}.`,
        eyebrow: 'تم تأكيد الطلب',
        title: `شكراً لطلبك، ${firstName}.`,
        intro: `لقد استلمنا الطلب <strong style="color:#17181c;font-weight:600;">#${orderId}</strong> وسنراسلك مجدداً فور شحنه.`,
        mOrder: 'الطلب', mDate: 'التاريخ', mTotal: 'الإجمالي',
        subtotalL: 'المجموع الفرعي', shippingL: 'الشحن', discountL: 'الخصم', vatL: 'ضريبة القيمة المضافة (5%، شاملة)', totalL: 'الإجمالي',
        free: 'مجاني', cta: 'عرض الطلب والفاتورة',
        deliveryAddr: 'عنوان التوصيل', paymentL: 'الدفع', paidLine: (p) => `${p} · مدفوع`
    } : {
        subjectPaid: `Payment confirmed — Order #${orderId} — Best Signature Auto Parts`,
        subjectNew: `Order confirmation #${orderId} — Best Signature Auto Parts`,
        preheader: `Order #${orderId} confirmed — total AED ${total}.`,
        eyebrow: 'Order confirmed',
        title: `Thanks for your order, ${firstName}.`,
        intro: `We've received order <strong style="color:#17181c;font-weight:600;">#${orderId}</strong> and will email you again the moment it ships.`,
        mOrder: 'Order', mDate: 'Date', mTotal: 'Total',
        subtotalL: 'Subtotal', shippingL: 'Shipping', discountL: 'Discount', vatL: 'VAT (5%, included)', totalL: 'Total',
        free: 'Free', cta: 'View order &amp; invoice',
        deliveryAddr: 'Delivery address', paymentL: 'Payment', paidLine: (p) => `${p} · Paid`
    };
    const freeLabel = ar ? 'مجاني' : 'FREE';
    const freeGiftWith = ar ? 'هدية مجانية مع' : 'Free gift with';

    const paymentDisplay = (ar ? {
        'bank_transfer': 'تحويل بنكي مباشر',
        'cod': 'الدفع عند الاستلام',
        'tabby': 'تابي (أقساط)',
        'card': 'بطاقة ائتمان/خصم'
    } : {
        'bank_transfer': 'Direct bank transfer',
        'cod': 'Cash on Delivery',
        'tabby': 'Tabby (Installments)',
        'card': 'Credit/Debit Card'
    })[orderData.payment_method] || orderData.payment_method || 'N/A';

    const itemRows = orderItems.map((item, i) => {
        const isFree = Number(item.is_free_gift) === 1;
        const lineTotal = Number((item.price_at_purchase || item.price || 0) * item.quantity).toFixed(2);
        const parentName = (ar && item.bundle_parent_name_ar) ? item.bundle_parent_name_ar : (item.bundle_parent_name || '');
        const itemName = (ar && item.name_ar) ? item.name_ar : (item.name || '');
        const variantLabel = buildVariantLabel(item, ar);
        const variantLine = variantLabel ? `<p style="margin:4px 0 0;font-family:${SANS};font-size:12px;color:#17181c;line-height:1.3;">${variantLabel}</p>` : '';
        const freeBadge = isFree ? ` <span style="display:inline-block;margin-inline-start:6px;padding:2px 7px;background:#ecfdf5;color:#10b981;font-size:10px;font-weight:700;border-radius:5px;letter-spacing:.04em;">${freeLabel}</span>` : '';
        const parentLine = (isFree && parentName) ? `<p style="margin:4px 0 0;font-family:${SANS};font-size:12px;color:#17181c;">${freeGiftWith} ${parentName}</p>` : '';
        const imgUrl = absolutizeEmailImage(item.image);
        const thumb = imgUrl
            ? `<img src="${imgUrl}" width="48" height="48" style="width:48px;height:48px;border-radius:8px;object-fit:contain;background:#ffffff;border:1px solid #e9e7e2;">`
            : `<div style="width:48px;height:48px;border-radius:8px;background:#ffffff;border:1px solid #e9e7e2;"></div>`;
        const priceText = isFree ? `<span style="color:#10b981;">${L.free}</span>` : `AED ${lineTotal}`;
        return `
<tr><td style="padding:${i === 0 ? '0 0 16px' : '16px 0'};border-bottom:1px solid #ecedef;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td width="60" style="vertical-align:middle;">${thumb}</td>
    <td style="vertical-align:middle;padding-${padStart}:16px;"><p style="margin:0;font-family:${SANS};font-size:14px;font-weight:600;color:#17181c;line-height:1.4;">${itemName}${freeBadge}</p><p style="margin:4px 0 0;font-family:${SANS};font-size:12px;color:#17181c;">${ar ? 'الكمية' : 'Qty'} ${item.quantity}</p>${variantLine}${parentLine}</td>
    <td align="${endAlign}" style="vertical-align:middle;white-space:nowrap;"><p style="margin:0;font-family:${SANS};font-size:14px;font-weight:600;color:#17181c;">${priceText}</p></td>
  </tr></table>
</td></tr>`;
    }).join('');

    const totalRow = (label, value, opts = {}) => `<tr><td style="padding:5px 0;font-family:${SANS};font-size:13px;color:${opts.danger ? '#ef4444' : '#17181c'};">${label}</td><td align="${endAlign}" style="padding:5px 0;font-family:${SANS};font-size:13px;font-weight:600;color:${opts.danger ? '#ef4444' : '#17181c'};">${value}</td></tr>`;

    const customerContent = `
<p style="margin:0 0 14px;font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#1488c0;">${L.eyebrow}</p>
<h1 style="margin:0 0 14px;font-family:${SERIF};font-size:34px;line-height:1.14;font-weight:600;letter-spacing:-.01em;color:#17181c;">${L.title}</h1>
<p style="margin:0 0 30px;font-family:${SANS};font-size:16px;line-height:1.65;color:#17181c;">${L.intro}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #ecedef;border-bottom:1px solid #ecedef;margin-bottom:30px;"><tr>
  <td style="padding:16px 0;text-align:center;border-${ar ? 'left' : 'right'}:1px solid #ecedef;"><p style="margin:0 0 5px;font-family:${SANS};font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#17181c;">${L.mOrder}</p><p style="margin:0;font-family:${SANS};font-size:14px;font-weight:600;color:#17181c;">#${orderId}</p></td>
  <td style="padding:16px 0;text-align:center;border-${ar ? 'left' : 'right'}:1px solid #ecedef;"><p style="margin:0 0 5px;font-family:${SANS};font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#17181c;">${L.mDate}</p><p style="margin:0;font-family:${SANS};font-size:14px;font-weight:600;color:#17181c;">${date}</p></td>
  <td style="padding:16px 0;text-align:center;"><p style="margin:0 0 5px;font-family:${SANS};font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#17181c;">${L.mTotal}</p><p style="margin:0;font-family:${SANS};font-size:14px;font-weight:600;color:#17181c;">AED ${total}</p></td>
</tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemRows}</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">
  ${totalRow(L.subtotalL, `AED ${subtotal}`)}
  ${totalRow(L.shippingL, deliveryNum > 0 ? `AED ${delivery}` : L.free)}
  ${Number(discount) > 0 ? totalRow(L.discountL, `-AED ${discount}`, { danger: true }) : ''}
  ${totalRow(L.vatL, `AED ${vat}`)}
  <tr><td colspan="2" style="border-top:1px solid #d9dade;padding-top:6px;"></td></tr>
  <tr><td style="padding:6px 0;font-family:${SERIF};font-size:17px;font-weight:600;color:#17181c;">${L.totalL}</td><td align="${endAlign}" style="padding:6px 0;font-family:${SERIF};font-size:20px;font-weight:700;color:#17181c;">AED ${total}</td></tr>
</table>
<div style="height:30px;"></div>
${dsButton(orderSummaryUrl, L.cta, ar)}
<div style="border-top:1px solid #ecedef;margin-top:34px;padding-top:28px;"></div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  <td width="50%" style="vertical-align:top;padding-${ar ? 'left' : 'right'}:18px;">
    <p style="margin:0 0 8px;font-family:${SANS};font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#17181c;">${L.deliveryAddr}</p>
    <p style="margin:0;font-family:${SANS};font-size:13px;line-height:1.7;color:#17181c;">${shipping.firstName || userName} ${shipping.lastName || ''}<br>${shipping.streetAddress || ''}<br>${shipping.city || ''}<br>${shipping.phone || ''}</p>
  </td>
  <td width="50%" style="vertical-align:top;border-${ar ? 'right' : 'left'}:1px solid #ecedef;padding-${ar ? 'right' : 'left'}:26px;">
    <p style="margin:0 0 8px;font-family:${SANS};font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#17181c;">${L.paymentL}</p>
    <p style="margin:0;font-family:${SANS};font-size:13px;line-height:1.7;color:#17181c;">${paymentDisplay}<br>${isPaid ? L.paidLine(`AED ${total}`) : `AED ${total}`}</p>
  </td>
</tr></table>`;

    const adminContent = `
<p style="margin:0 0 14px;font-family:${DS_SANS};font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#e62127;">New order received</p>
<h1 style="margin:0 0 14px;font-family:${DS_SERIF};font-size:32px;line-height:1.14;font-weight:600;letter-spacing:-.01em;color:#17181c;">Order #${orderId}</h1>
<p style="margin:0 0 24px;font-family:${DS_SANS};font-size:15px;line-height:1.65;color:#17181c;">A new order has just been placed on Best Signature Auto Parts. Review and process it in the admin dashboard.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #ecedef;border-radius:12px;margin-bottom:24px;"><tr><td style="padding:18px 20px;font-family:${DS_SANS};font-size:13px;line-height:1.9;color:#17181c;">
  <span style="color:#17181c;">Customer</span> <strong style="color:#17181c;">${userName}</strong><br>
  ${billing.email ? `<span style="color:#17181c;">Email</span> <strong style="color:#17181c;">${billing.email}</strong><br>` : ''}
  ${(shipping.phone || billing.phone) ? `<span style="color:#17181c;">Phone</span> <strong style="color:#17181c;">${shipping.phone || billing.phone}</strong><br>` : ''}
  <span style="color:#17181c;">Payment</span> <strong style="color:#17181c;">${paymentDisplay}${isPaid ? ' (Paid)' : ''}</strong><br>
  <span style="color:#17181c;">Total</span> <strong style="color:#17181c;">AED ${total}</strong>
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemRows}</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">
  ${totalRow(L.subtotalL, `AED ${subtotal}`)}
  ${totalRow(L.shippingL, deliveryNum > 0 ? `AED ${delivery}` : L.free)}
  ${Number(discount) > 0 ? totalRow(L.discountL, `-AED ${discount}`, { danger: true }) : ''}
  ${totalRow(L.vatL, `AED ${vat}`)}
  <tr><td colspan="2" style="border-top:1px solid #d9dade;padding-top:6px;"></td></tr>
  <tr><td style="padding:6px 0;font-family:${DS_SERIF};font-size:17px;font-weight:600;color:#17181c;">${L.totalL}</td><td align="right" style="padding:6px 0;font-family:${DS_SERIF};font-size:20px;font-weight:700;color:#17181c;">AED ${total}</td></tr>
</table>`;

    const html = dsShell({ ar, preheader: isAdminCopy ? `New order #${orderId} — AED ${total}` : L.preheader, content: isAdminCopy ? adminContent : customerContent });

    try {
        const subject = isAdminCopy ? `New order received — #${orderId}` : (isPaid ? L.subjectPaid : L.subjectNew);
        await transporter.sendMail({ from: `"Best Signature Auto Parts" <${process.env.SMTP_EMAIL}>`, to: toEmail, subject, html, attachments: dsEmailAttachments(ar) });
        console.log(`[EMAIL] ✅ Order confirmation email sent to ${toEmail}`);
    } catch (error) {
        console.error(`[EMAIL] ❌ Failed to send order confirmation email to ${toEmail}:`, error.message);
    }
};


/**
 * Send a welcome email to the new user
 */
const sendWelcomeEmail = async (toEmail, userName, locale = 'en') => {
    const transporter = createTransporter();
    const ar = isAr(locale);
    const SITE = process.env.FRONTEND_URL || 'https://bestsignatureautoparts.com';
    const SANS = ar ? DS_SANS_AR : DS_SANS;
    const SERIF = ar ? DS_SERIF_AR : DS_SERIF;
    const firstName = String(userName || '').split(' ')[0] || (ar ? 'صديقنا' : 'there');
    const L = ar ? {
        subject: `مرحباً بك في ماريوت، ${firstName} — نقاطك الترحيبية جاهزة`,
        text: `مرحباً ${userName}،\n\nأهلاً بك في ماريوت! لقد حصلت على 1,000 نقطة ترحيبية.\n\nفريق ماريوت`,
        preheader: 'مرحباً بك في ماريوت — نقاطك الترحيبية البالغة 1,000 نقطة جاهزة.',
        eyebrow: 'مرحباً بك في ماريوت',
        title: 'مطبخك،<br>مجهّز بالكامل.',
        intro: `مرحباً <strong style="color:#17181c;font-weight:600;">${firstName}</strong> — أهلاً بك في ماريوت، وجهة الإمارات لمعدات المطابخ الاحترافية من أكثر من <strong style="color:#17181c;font-weight:600;">80 علامة تجارية عالمية</strong> بما في ذلك Rational وHoshizaki وVitamix وLa Marzocco.`,
        items: [
            ['تسوّق الأفضل', 'أفران وتبريد ومعدات تحضير وقهوة يثق بها المحترفون.'],
            ['1,000 نقطة ترحيبية', 'أُضيفت بالفعل إلى حسابك — استخدمها في طلبك الأول.'],
            ['دفع أسرع', 'احفظ عناوينك ووسائل الدفع لإعادة الطلب بنقرة واحدة.'],
        ],
        cta: 'ابدأ التسوق',
        help: 'هل تحتاج مساعدة في اختيار المعدات؟ يردّ مختصونا خلال يوم عمل واحد على',
    } : {
        subject: `Welcome to Best Signature, ${firstName} — your welcome points are ready`,
        text: `Hi ${userName},\n\nWelcome to Best Signature! You've been credited with 1,000 welcome points.\n\nThe Best Signature Team`,
        preheader: "Welcome to Best Signature — your 1,000 welcome points are ready.",
        eyebrow: 'Welcome to Best Signature',
        title: 'Premium auto parts,<br>built for every journey.',
        intro: `Hi <strong style="color:#17181c;font-weight:600;">${firstName}</strong> — welcome to Best Signature, the UAE's destination for professional auto spare parts from <strong style="color:#17181c;font-weight:600;">80+ world-class brands</strong> including Rational, Hoshizaki, Vitamix and La Marzocco.`,
        items: [
            ['Shop the very best', 'Genuine, OEM, and quality spare parts for leading vehicle brands.'],
            ['1,000 welcome points', 'Already credited to your account — redeem them on your first order.'],
            ['Faster checkout', 'Save addresses &amp; payment for one-tap reordering of your essentials.'],
        ],
        cta: 'Start shopping',
        help: 'Need help choosing equipment? Our specialists reply within one business day at',
    };

    const listRows = L.items.map(([h, d], i) => `
  <tr><td style="padding:18px 0;border-bottom:1px solid #ecedef;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="52" style="vertical-align:top;"><span style="font-family:${SERIF};font-size:20px;font-weight:600;font-style:italic;color:#19489D;">0${i + 1}</span></td>
      <td style="vertical-align:top;">
        <p style="margin:0 0 3px;font-family:${SANS};font-size:15px;font-weight:600;color:#17181c;">${h}</p>
        <p style="margin:0;font-family:${SANS};font-size:14px;line-height:1.6;color:#17181c;">${d}</p>
      </td>
    </tr></table>
  </td></tr>`).join('');

    const content = `
<p style="margin:0 0 16px;font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#1488c0;">${L.eyebrow}</p>
<h1 style="margin:0 0 18px;font-family:${SERIF};font-size:38px;line-height:1.12;font-weight:600;letter-spacing:-.01em;color:#17181c;">${L.title}</h1>
<p style="margin:0 0 30px;font-family:${SANS};font-size:16px;line-height:1.68;color:#17181c;">${L.intro}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #ecedef;">${listRows}</table>
<div style="height:34px;"></div>
${dsButton(SITE, L.cta, ar)}
<div style="height:34px;"></div>
<div style="border-top:1px solid #ecedef;padding-top:22px;">
  <p style="margin:0;font-family:${SANS};font-size:14px;line-height:1.65;color:#17181c;">${L.help} <a href="mailto:support@bestsignatureautoparts.com" style="color:#1488c0;text-decoration:none;font-weight:600;">support@bestsignatureautoparts.com</a>.</p>
</div>`;

    const mailOptions = {
        from: `"Best Signature Auto Parts" <${process.env.SMTP_EMAIL}>`,
        to: toEmail,
        subject: L.subject,
        text: L.text,
        html: dsShell({ ar, preheader: L.preheader, content }),
        attachments: dsEmailAttachments(ar)
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`[EMAIL] ✅ Welcome email sent to ${toEmail}`);
    } catch (error) {
        console.error(`[EMAIL] ❌ Failed to send welcome email to ${toEmail}:`, error.message);
    }
};

/**
 * Send a quotation email to the customer
 */
const sendQuotationEmail = async (toEmail, userName, quotationRef, finalAmount, items = [], locale = 'en', totals = {}, pdfBuffer = null) => {
    const transporter = createTransporter();
    const ar = isAr(locale);
    const SITE = process.env.FRONTEND_URL || 'https://bestsignatureautoparts.com';
    const SANS = ar ? DS_SANS_AR : DS_SANS;
    const SERIF = ar ? DS_SERIF_AR : DS_SERIF;
    const endAlign = ar ? 'left' : 'right';
    const firstName = String(userName || '').split(' ')[0] || (ar ? 'عميلنا' : 'there');
    const validUntil = new Date(Date.now() + 15 * 86400000).toLocaleDateString(ar ? 'ar-AE' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const L = ar ? {
        subject: `عرض السعر من متجر ماريوت — ${quotationRef}`,
        eyebrow: 'عرض سعر',
        title: 'عرض سعرك جاهز',
        intro: `شكراً على استفسارك، ${firstName}. تجد أدناه عرض السعر الرسمي <strong style="color:#17181c;font-weight:600;">#${quotationRef}</strong>. الأسعار مثبّتة لمدة 15 يوماً.`,
        validLine: 'عرض السعر صالح حتى', ref: 'المرجع',
        item: 'المنتج', qty: 'الكمية', unit: 'سعر الوحدة',
        subtotal: 'المجموع الفرعي', couponL: 'خصم القسيمة', pointsL: 'خصم النقاط', vatL: 'ضريبة القيمة المضافة (5%)', estTotal: 'الإجمالي التقديري',
        free: 'مجاني', cta: 'مراجعة العرض وقبوله',
        note: 'هذا عرض سعر وليس فاتورة. لا يُستحق أي دفع حتى تؤكد الطلب. تُؤكَّد مدة التوصيل عند القبول.'
    } : {
        subject: `Your quotation from Best Signature Auto Parts — ${quotationRef}`,
        eyebrow: 'Quotation',
        title: 'Your quote is ready',
        intro: `Thank you for your enquiry, ${firstName}. Please find your formal quotation <strong style="color:#17181c;font-weight:600;">#${quotationRef}</strong> below. Prices are held for 15 days.`,
        validLine: 'Quotation valid until', ref: 'Ref',
        item: 'Item', qty: 'Qty', unit: 'Unit price',
        subtotal: 'Subtotal', couponL: 'Coupon discount', pointsL: 'Reward points', vatL: 'VAT (5%)', estTotal: 'Estimated total',
        free: 'FREE', cta: 'Review &amp; accept quote',
        note: 'This is a quotation, not an invoice. No payment is due until you confirm the order. Delivery lead times are confirmed on acceptance.'
    };

    const itemRows = items.map(item => {
        const itemName = (ar && item.name_ar) ? item.name_ar : (item.name || '');
        const isFree = Number(item.is_free_gift) === 1;
        const priceCell = isFree ? L.free : `AED ${Number(item.price || 0).toFixed(2)}`;
        return `<tr><td style="padding:11px 0;border-bottom:1px solid #ecedef;font-family:${SANS};font-size:13px;color:#17181c;">${itemName}</td><td align="center" style="padding:11px 0;border-bottom:1px solid #ecedef;font-family:${SANS};font-size:13px;color:#17181c;">${item.quantity}</td><td align="${endAlign}" style="padding:11px 0;border-bottom:1px solid #ecedef;font-family:${SANS};font-size:13px;font-weight:600;color:#17181c;">${priceCell}</td></tr>`;
    }).join('');

    const subtotalNum = Number(totals.subtotal || 0);
    const couponNum = Number(totals.coupon_discount || 0);
    const pointsNum = Number(totals.points_discount || 0);
    const vatNum = Number(totals.tax_amount || 0);
    const couponCode = totals.coupon_code ? ` (${totals.coupon_code})` : '';
    const pointsUsed = Number(totals.points_used || 0);
    const sumRow = (label, value, color) => `<tr><td style="padding:6px 0;font-family:${SANS};font-size:13px;font-weight:400;color:#17181c;">${label}</td><td align="${endAlign}" style="padding:6px 0;font-family:${SANS};font-size:13px;font-weight:600;color:${color || '#17181c'};">${value}</td></tr>`;
    const summaryRows = `
  ${subtotalNum > 0 ? sumRow(L.subtotal, `AED ${subtotalNum.toFixed(2)}`) : ''}
  ${couponNum > 0 ? sumRow(`${L.couponL}${couponCode}`, `- AED ${couponNum.toFixed(2)}`, '#10b981') : ''}
  ${pointsNum > 0 ? sumRow(`${L.pointsL}${pointsUsed > 0 ? ` (${pointsUsed} pts)` : ''}`, `- AED ${pointsNum.toFixed(2)}`, '#10b981') : ''}
  ${vatNum > 0 ? sumRow(L.vatL, `AED ${vatNum.toFixed(2)}`) : ''}`;

    const content = `
<p style="margin:0 0 14px;font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#1488c0;">${L.eyebrow}</p>
<h1 style="margin:0 0 18px;font-family:${SERIF};font-size:34px;line-height:1.16;font-weight:600;letter-spacing:-.01em;color:#17181c;">${L.title}</h1>
<p style="margin:0 0 18px;font-family:${SANS};font-size:15px;line-height:1.65;color:#17181c;">${L.intro}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e9e7e2;border-radius:12px;margin:4px 0 24px;"><tr>
  <td style="padding:14px 18px;font-family:${SANS};font-size:13px;color:#1488c0;font-weight:600;">${L.validLine} <strong style="color:#17181c;">${validUntil}</strong></td>
  <td align="${endAlign}" style="padding:14px 18px;font-family:${SANS};font-size:13px;color:#1488c0;font-weight:600;">${L.ref}: ${quotationRef}</td>
</tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px;"><tr>
  <td style="padding:0 0 8px;font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#17181c;border-bottom:2px solid #ecedef;">${L.item}</td>
  <td align="center" style="padding:0 0 8px;font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#17181c;border-bottom:2px solid #ecedef;">${L.qty}</td>
  <td align="${endAlign}" style="padding:0 0 8px;font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#17181c;border-bottom:2px solid #ecedef;">${L.unit}</td>
</tr>${itemRows}</table>
<table role="presentation" width="60%" cellpadding="0" cellspacing="0" align="${endAlign}" style="margin-top:14px;">
  ${summaryRows}
  <tr><td colspan="2" style="border-top:2px solid #ecedef;padding-top:6px;"></td></tr>
  <tr><td style="padding:6px 0;font-family:${SANS};font-size:15px;font-weight:700;color:#17181c;">${L.estTotal}</td><td align="${endAlign}" style="padding:6px 0;font-family:${SANS};font-size:18px;font-weight:800;color:#17181c;">AED ${Number(finalAmount).toFixed(2)}</td></tr>
</table>
<div style="clear:both;height:28px;"></div>
${dsButton(`${SITE}/${ar ? 'ar' : 'en'}/profile?tab=quotations`, L.cta, ar)}
<div style="height:22px;"></div>
<p style="margin:0;font-family:${SANS};font-size:12px;line-height:1.6;color:#17181c;">${L.note}</p>`;

    const attachments = [
        ...dsEmailAttachments(ar),
        ...(pdfBuffer ? [{
            filename: `${quotationRef}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf'
        }] : [])
    ];

    const mailOptions = {
        from: `"Best Signature Auto Parts" <${process.env.SMTP_EMAIL}>`,
        to: toEmail,
        subject: L.subject,
        html: dsShell({ ar, preheader: `${ar ? 'عرض السعر' : 'Quotation'} ${quotationRef} — ${ar ? 'صالح حتى' : 'valid until'} ${validUntil}`, content }),
        attachments
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`[EMAIL] ✅ Quotation email sent to ${toEmail}${pdfBuffer ? ' (with PDF)' : ''}`);
    } catch (error) {
        console.error(`[EMAIL] ❌ Failed to send quotation email to ${toEmail}:`, error.message);
        throw error;
    }
};

/**
 * Send an order status update email to the user (e.g. Shipped, Delivered)
 */
const sendOrderStatusUpdateEmail = async (toEmail, userName, orderId, status, orderData = {}, locale = 'en') => {
    const transporter = createTransporter();
    const ar = isAr(locale);

    const orderItems = orderData.items || [];
    const total = Number(orderData.final_amount || 0).toFixed(2);
    const date = new Date(orderData.created_at || Date.now()).toLocaleDateString(ar ? 'ar-AE' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const SITE = process.env.FRONTEND_URL || 'https://bestsignatureautoparts.com';
    // Locale-prefixed so the profile page's deep-link guard (tab/orderId) fires:
    // not logged in → /signin?redirectTo=… → returns to the orders tab after login.
    const orderSummaryUrl = `${SITE}/${ar ? 'ar' : 'en'}/profile?tab=yourOrders&orderId=${orderId}&view=summary`;
    const billing = orderData.billing_details || {};
    const shipping = orderData.shipping_address || billing;

    const statusMessages = ar ? {
        'processing': 'قيد المعالجة',
        'shipped': 'في الطريق إليك',
        'delivered': 'تم توصيله',
        'cancelled': 'تم إلغاؤه',
        'pending': 'قيد الانتظار'
    } : {
        'processing': 'is being processed',
        'shipped': 'is on its way',
        'delivered': 'has been delivered',
        'cancelled': 'has been cancelled',
        'pending': 'is pending'
    };
    const statusTitles = ar ? {
        'processing': 'قيد المعالجة', 'shipped': 'تم الشحن', 'delivered': 'تم التوصيل',
        'cancelled': 'ملغى', 'pending': 'قيد الانتظار'
    } : {};

    const statusTitle = statusTitles[status.toLowerCase()] || (status.charAt(0).toUpperCase() + status.slice(1));
    const friendlyStatus = statusMessages[status.toLowerCase()] || (ar ? `أصبح ${status}` : `is now ${status}`);

    const isCancelled = status.toLowerCase() === 'cancelled';
    const SANS = ar ? DS_SANS_AR : DS_SANS;
    const SERIF = ar ? DS_SERIF_AR : DS_SERIF;
    const endAlign = ar ? 'left' : 'right';
    const padStart = ar ? 'right' : 'left';
    // Estimated delivery ≈ 3 days out (display only).
    const estDate = new Date(Date.now() + 3 * 86400000).toLocaleDateString(ar ? 'ar-AE' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

    // Per-status eyebrow + headline + intro, matching the DS shipment voice.
    const byStatus = (ar ? {
        processing: ['تحديث الطلب', 'يتم تجهيز طلبك', `أخبار جيدة، ${userName.split(' ')[0]} — طلبك <strong style="color:#17181c;">#${orderId}</strong> قيد التجهيز الآن.`],
        shipped: ['تحديث الشحنة', 'طلبك في الطريق إليك', `أخبار جيدة، ${userName.split(' ')[0]} — تم شحن طلبك <strong style="color:#17181c;">#${orderId}</strong> وهو في طريقه إليك الآن.`],
        delivered: ['تم التوصيل', 'تم توصيل طلبك', `تم توصيل طلبك <strong style="color:#17181c;">#${orderId}</strong>. نتمنى أن تستمتع به!`],
        pending: ['تحديث الطلب', 'تم استلام طلبك', `استلمنا طلبك <strong style="color:#17181c;">#${orderId}</strong> وهو قيد الانتظار.`]
    } : {
        processing: ['Order update', 'Your order is being prepared', `Good news, ${userName.split(' ')[0]} — order <strong style="color:#17181c;">#${orderId}</strong> is being prepared now.`],
        shipped: ['Shipment update', 'Your order is on its way', `Good news, ${userName.split(' ')[0]} — order <strong style="color:#17181c;">#${orderId}</strong> has been dispatched and is heading to you now.`],
        delivered: ['Delivered', 'Your order has been delivered', `Order <strong style="color:#17181c;">#${orderId}</strong> has been delivered. We hope you enjoy it!`],
        pending: ['Order update', 'Your order is received', `We've received order <strong style="color:#17181c;">#${orderId}</strong> and it's pending.`]
    });
    const [eyebrowTxt, titleTxt, introTxt] = isCancelled
        ? (ar ? ['تم الإلغاء', 'تم إلغاء طلبك', `نؤكد أنه تم إلغاء طلبك <strong style="color:#17181c;">#${orderId}</strong>.`]
              : ['Order cancelled', 'Your order has been cancelled', `We're writing to confirm that order <strong style="color:#17181c;">#${orderId}</strong> has been cancelled.`])
        : (byStatus[status.toLowerCase()] || byStatus.processing);

    const L = ar ? {
        subject: orderData.subject || `طلبك #${orderId} ${friendlyStatus} — متجر ماريوت`,
        eyebrow: eyebrowTxt, title: titleTxt, intro: introTxt,
        cancelNote: 'تم استرداد أي نقاط مكافآت استخدمتها في هذا الطلب، وتم عكس النقاط المكتسبة. إذا تم خصمك، فسيتم رد المبلغ وفقاً لطريقة الدفع.',
        s1: 'تم الطلب', s2: 'تم التجهيز', s3: 'تم الشحن', s4: 'تم التوصيل',
        trackingNo: 'رقم التتبع', estDelivery: 'التوصيل المتوقع',
        inShipment: 'في هذه الشحنة', orderItemsL: 'عناصر الطلب',
        cta: isCancelled ? 'عرض الطلب' : (status.toLowerCase() === 'delivered' ? 'عرض الطلب' : 'تتبّع طلبي'),
        freeLabel: 'مجاني', freeGiftWith: 'هدية مجانية مع'
    } : {
        subject: orderData.subject || `Your order #${orderId} ${friendlyStatus} — Best Signature Auto Parts`,
        eyebrow: eyebrowTxt, title: titleTxt, intro: introTxt,
        cancelNote: 'Any reward points redeemed on this order have been refunded, and points earned have been reversed. If you were charged, a refund will follow per your payment method.',
        s1: 'Ordered', s2: 'Packed', s3: 'Shipped', s4: 'Delivered',
        trackingNo: 'Tracking number', estDelivery: 'Estimated delivery',
        inShipment: 'In this shipment', orderItemsL: 'Order items',
        cta: isCancelled ? 'View order' : (status.toLowerCase() === 'delivered' ? 'View order' : 'Track my order'),
        freeLabel: 'FREE', freeGiftWith: 'Free gift with'
    };

    // Progress timeline (Ordered → Packed → Shipped → Delivered) reflecting status.
    const stage = ({ pending: 0, processing: 1, shipped: 2, delivered: 3 })[status.toLowerCase()] ?? 1;
    const stepLabels = [L.s1, L.s2, L.s3, L.s4];
    const timelineCells = stepLabels.map((label, s) => {
        const done = s <= stage;
        const circle = done
            ? `<div style="width:22px;height:22px;border-radius:50%;background:#19489D;border:2px solid #19489D;margin:0 auto;line-height:18px;text-align:center;"><span style="color:#fff;font-size:11px;font-weight:700;">&#10003;</span></div>`
            : `<div style="width:22px;height:22px;border-radius:50%;background:#ffffff;border:2px solid #ecedef;margin:0 auto;line-height:18px;text-align:center;"></div>`;
        const connector = s > 0 ? `<div style="position:absolute;top:12px;left:-50%;width:100%;height:2px;background:${s <= stage ? '#19489D' : '#ecedef'};z-index:1;"></div>` : '';
        const labelStyle = `font-family:${SANS};font-size:11px;font-weight:${s === stage ? 700 : 500};color:${done ? '#17181c' : '#17181c'};`;
        return `<td width="25%" style="text-align:center;vertical-align:top;"><div style="position:relative;">${connector}<div style="position:relative;z-index:2;">${circle}</div></div><p style="margin:8px 0 0;${labelStyle}">${label}</p></td>`;
    }).join('');
    const timeline = isCancelled ? '' : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #ecedef;border-radius:14px;margin:6px 0 24px;"><tr><td style="padding:24px 20px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${timelineCells}</tr></table></td></tr></table>`;

    const trackingRow = isCancelled ? '' : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;"><tr>
  <td width="50%" style="vertical-align:top;"><p style="margin:0 0 4px;font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#17181c;">${L.trackingNo}</p><p style="margin:0;font-family:${SANS};font-size:15px;font-weight:700;color:#1488c0;">${orderId}</p></td>
  <td width="50%" style="vertical-align:top;"><p style="margin:0 0 4px;font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#17181c;">${L.estDelivery}</p><p style="margin:0;font-family:${SANS};font-size:15px;font-weight:700;color:#17181c;">${estDate}</p></td>
</tr></table>`;

    const cancelNote = isCancelled ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 24px;"><tr><td style="background:#fdeaea;border-radius:12px;padding:16px 18px;"><p style="margin:0;font-family:${SANS};font-size:13px;line-height:1.6;color:#9a1c1c;">${L.cancelNote}</p></td></tr></table>` : '';

    const itemRows = orderItems.map(item => {
        const itemName = (ar && item.name_ar) ? item.name_ar : (item.name || '');
        const parentName = (ar && item.bundle_parent_name_ar) ? item.bundle_parent_name_ar : (item.bundle_parent_name || '');
        const variantLabel = buildVariantLabel(item, ar);
        const variantLine = variantLabel ? `<p style="margin:4px 0 0;font-family:${SANS};font-size:12px;color:#17181c;line-height:1.3;">${variantLabel}</p>` : '';
        const freeBadge = Number(item.is_free_gift) === 1 ? ` <span style="display:inline-block;margin-inline-start:6px;padding:2px 7px;background:#ecfdf5;color:#10b981;font-size:10px;font-weight:700;border-radius:5px;letter-spacing:.04em;">${L.freeLabel}</span>` : '';
        const parentLine = (Number(item.is_free_gift) === 1 && parentName) ? `<p style="margin:4px 0 0;font-family:${SANS};font-size:12px;color:#17181c;">${L.freeGiftWith} ${parentName}</p>` : '';
        const imgUrl = absolutizeEmailImage(item.image);
        const thumb = imgUrl
            ? `<img src="${imgUrl}" width="44" height="44" style="width:44px;height:44px;border-radius:8px;object-fit:contain;background:#ffffff;border:1px solid #ecedef;">`
            : `<div style="width:44px;height:44px;border-radius:8px;background:#ffffff;border:1px solid #ecedef;"></div>`;
        return `
<tr><td style="padding:12px 0;border-bottom:1px solid #ecedef;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  <td width="52" style="vertical-align:middle;">${thumb}</td>
  <td style="vertical-align:middle;padding-${padStart}:14px;"><p style="margin:0;font-family:${SANS};font-size:14px;font-weight:600;color:#17181c;">${itemName}${freeBadge}</p>${variantLine}${parentLine}</td>
  <td align="${endAlign}" style="vertical-align:middle;"><span style="display:inline-block;padding:3px 9px;background:#ffffff;border:1px solid #ecedef;border-radius:6px;font-family:${SANS};font-size:12px;font-weight:700;color:#17181c;">x${item.quantity}</span></td>
</tr></table></td></tr>`;
    }).join('');

    const content = `
<p style="margin:0 0 14px;font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${isCancelled ? '#e62127' : '#1488c0'};">${L.eyebrow}</p>
<h1 style="margin:0 0 18px;font-family:${SERIF};font-size:34px;line-height:1.16;font-weight:600;letter-spacing:-.01em;color:#17181c;">${L.title}</h1>
<p style="margin:0 0 18px;font-family:${SANS};font-size:15px;line-height:1.65;color:#17181c;">${L.intro}</p>
${cancelNote}
${timeline}
${trackingRow}
${dsButton(orderSummaryUrl, L.cta, ar)}
<div style="height:26px;"></div>
<p style="margin:0 0 12px;font-family:${SANS};font-size:13px;font-weight:700;color:#17181c;">${isCancelled ? L.orderItemsL : L.inShipment}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemRows}</table>`;

    const mailOptions = {
        from: `"Best Signature Auto Parts" <${process.env.SMTP_EMAIL}>`,
        to: toEmail,
        subject: L.subject,
        html: dsShell({ ar, preheader: `${L.title} — #${orderId}`, content }),
        attachments: dsEmailAttachments(ar)
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`[EMAIL] ✅ Order status update email sent to ${toEmail}`);
    } catch (error) {
        console.error(`[EMAIL] ❌ Failed to send status update email to ${toEmail}:`, error.message);
    }
};

/**
 * Send an abandoned cart reminder email
 * @param {string} toEmail 
 * @param {string} userName 
 * @param {Array} cartItems - [{name, quantity, price, offer_price, image, slug}]
 * @param {number} reminderNumber - 1 = first reminder, 2 = second reminder
 */
const sendAbandonedCartEmail = async (toEmail, userName, cartItems = [], reminderNumber = 1, locale = 'en') => {
    const transporter = createTransporter();
    const SITE = process.env.FRONTEND_URL || 'https://bestsignatureautoparts.com';
    const ar = isAr(locale);

    const SANS = ar ? DS_SANS_AR : DS_SANS;
    const SERIF = ar ? DS_SERIF_AR : DS_SERIF;
    const endAlign = ar ? 'left' : 'right';
    const padStart = ar ? 'right' : 'left';
    const L = ar ? {
        eyebrow: 'تركت شيئاً خلفك',
        title1: 'ما زلت تفكر في الأمر؟',
        title2: 'سلّتك لا تزال بانتظارك',
        intro: 'سلّتك محفوظة وبانتظارك. المعدات أدناه متوفرة الآن — أكمل طلبك قبل نفادها.',
        incentiveTitle: 'إليك خصم 5% ليساعدك على اتخاذ القرار',
        incentiveCode: 'استخدم الرمز <strong style="color:#17181c;letter-spacing:.04em;">COMEBACK5</strong> عند الدفع',
        cta: 'العودة إلى سلّتي',
        note: 'قد تتغير الأسعار والتوفّر. السلة محفوظة لمدة 7 أيام.',
        subject1: 'سلّتك في ماريوت بانتظارك — خصم 5% بالداخل',
        subject2: 'لا تزال مهتماً؟ أكمل طلبك — متجر ماريوت'
    } : {
        eyebrow: 'You left something behind',
        title1: 'Still thinking it over?',
        title2: 'Your cart is still waiting',
        intro: 'Your cart is saved and waiting. The equipment below is in stock now — complete your order before it sells out.',
        incentiveTitle: "Here's 5% off to help you decide",
        incentiveCode: 'Use code <strong style="color:#17181c;letter-spacing:.04em;">COMEBACK5</strong> at checkout',
        cta: 'Return to my cart',
        note: 'Prices and availability may change. Cart held for 7 days.',
        subject1: 'Your Best Signature cart is waiting — 5% off inside',
        subject2: 'Still interested? Complete your order — Best Signature Auto Parts'
    };

    const itemRows = cartItems.map(item => {
        const effectivePrice = Number(item.offer_price || item.price || 0);
        const originalPrice = Number(item.price || 0);
        const hasDiscount = item.offer_price && item.offer_price < item.price;
        const itemName = (ar && item.name_ar) ? item.name_ar : (item.name || '');
        const imgUrl = absolutizeEmailImage(item.image);
        const thumb = imgUrl
            ? `<img src="${imgUrl}" width="52" height="52" style="width:52px;height:52px;border-radius:8px;object-fit:contain;background:#ffffff;border:1px solid #ecedef;">`
            : `<div style="width:52px;height:52px;border-radius:8px;background:#ffffff;border:1px solid #ecedef;"></div>`;
        const priceCell = hasDiscount
            ? `<p style="margin:0;font-family:${SANS};font-size:14px;font-weight:700;color:#17181c;">AED ${(effectivePrice * item.quantity).toFixed(2)}</p><p style="margin:2px 0 0;font-family:${SANS};font-size:12px;color:#17181c;text-decoration:line-through;">AED ${(originalPrice * item.quantity).toFixed(2)}</p>`
            : `<p style="margin:0;font-family:${SANS};font-size:14px;font-weight:700;color:#17181c;">AED ${(effectivePrice * item.quantity).toFixed(2)}</p>`;
        return `
<tr><td style="padding:14px 0;border-bottom:1px solid #ecedef;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  <td width="60" style="vertical-align:middle;"><a href="${SITE}/product/${item.slug || ''}" style="text-decoration:none;">${thumb}</a></td>
  <td style="vertical-align:middle;padding-${padStart}:14px;"><a href="${SITE}/product/${item.slug || ''}" style="text-decoration:none;font-family:${SANS};font-size:14px;font-weight:600;color:#17181c;line-height:1.4;display:block;">${itemName}</a><p style="margin:4px 0 0;font-family:${SANS};font-size:12px;color:#17181c;">${ar ? 'الكمية' : 'Qty'} ${item.quantity}</p></td>
  <td align="${endAlign}" style="vertical-align:middle;white-space:nowrap;">${priceCell}</td>
</tr></table></td></tr>`;
    }).join('');

    const content = `
<p style="margin:0 0 14px;font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#1488c0;">${L.eyebrow}</p>
<h1 style="margin:0 0 18px;font-family:${SERIF};font-size:34px;line-height:1.16;font-weight:600;letter-spacing:-.01em;color:#17181c;">${reminderNumber === 1 ? L.title1 : L.title2}</h1>
<p style="margin:0 0 18px;font-family:${SANS};font-size:15px;line-height:1.65;color:#17181c;">${L.intro}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">${itemRows}</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 24px;"><tr><td style="background:#fdeaea;border-radius:12px;padding:16px 18px;text-align:center;">
  <p style="margin:0 0 2px;font-family:${SANS};font-size:13px;font-weight:700;color:#e62127;">${L.incentiveTitle}</p>
  <p style="margin:0;font-family:${SANS};font-size:13px;color:#17181c;">${L.incentiveCode}</p>
</td></tr></table>
${dsButton(`${SITE}/cart`, L.cta, ar)}
<div style="height:22px;"></div>
<p style="margin:0;text-align:center;font-family:${SANS};font-size:12px;color:#17181c;">${L.note}</p>`;

    const subject = reminderNumber === 1 ? L.subject1 : L.subject2;

    try {
        await transporter.sendMail({ from: `"Best Signature Auto Parts" <${process.env.SMTP_EMAIL}>`, to: toEmail, subject, html: dsShell({ ar, preheader: subject, content }), attachments: dsEmailAttachments(ar) });
        console.log(`[EMAIL] ✅ Abandoned cart reminder #${reminderNumber} sent to ${toEmail}`);
    } catch (error) {
        console.error(`[EMAIL] ❌ Failed to send abandoned cart email to ${toEmail}:`, error.message);
    }
};

/**
 * Send an offer notification email to a user about a product on special offer
 * @param {string} toEmail
 * @param {string} userName
 * @param {{ name: string, slug: string, price: number, offer_price: number|null, primaryImage: string|null }} product
 * @param {string} offerLabel - e.g. "Limited Offer", "Daily Offer"
 */
const sendOfferNotificationEmail = async (toEmail, userName, product, offerLabel, locale = 'en') => {
    const transporter = createTransporter();
    const ar = isAr(locale);
    const SITE = process.env.FRONTEND_URL || 'https://bestsignatureautoparts.com';
    const productUrl = `${SITE}/${ar ? 'ar' : 'en'}/product/${product.slug}`;
    const imageUrl = absolutizeEmailImage(product.primaryImage);
    const productName = (ar && product.name_ar) ? product.name_ar : product.name;
    const hasDiscount = product.offer_price && Number(product.offer_price) < Number(product.price);
    const displayPrice = hasDiscount ? Number(product.offer_price).toFixed(2) : Number(product.price).toFixed(2);
    const originalPrice = Number(product.price).toFixed(2);

    const SANS = ar ? DS_SANS_AR : DS_SANS;
    const SERIF = ar ? DS_SERIF_AR : DS_SERIF;
    const discountPct = hasDiscount ? Math.round((1 - Number(product.offer_price) / Number(product.price)) * 100) : 0;
    // Eyebrow label per offer type (no emoji) + accent color.
    const labels = ar ? {
        'Limited Offer': 'عرض محدود', 'Daily Offer': 'عرض اليوم', 'Weekly Deal': 'صفقة الأسبوع', 'Featured': 'منتج مميز', 'Best Seller': 'الأكثر مبيعاً'
    } : {
        'Limited Offer': 'Limited offer', 'Daily Offer': 'Daily offer', 'Weekly Deal': 'Weekly deal', 'Featured': 'Featured', 'Best Seller': 'Best seller'
    };
    const eyebrow = labels[offerLabel] || offerLabel;
    const accent = (offerLabel === 'Featured') ? '#1488c0' : (offerLabel === 'Best Seller') ? '#10b981' : '#e62127';
    const L = ar ? {
        title: hasDiscount ? `وفّر ${discountPct}% على ${productName}` : productName,
        intro: hasDiscount ? `لفترة محدودة، احصل على خصم ${discountPct}% على ${productName} — موثوق به في المطابخ الاحترافية في المنطقة.` : `اكتشف ${productName} — مختار بعناية من ماريوت لمعدات المطابخ الاحترافية.`,
        cta: 'تسوّق العرض',
        note: 'بينما تدوم الكمية.'
    } : {
        title: hasDiscount ? `Save ${discountPct}% on ${productName}` : productName,
        intro: hasDiscount ? `For a limited time, take ${discountPct}% off the ${productName} — trusted by drivers and workshops across the UAE.` : `Discover the ${productName} — selected from Best Signature's professional auto spare parts range.`,
        cta: 'Shop the offer',
        note: 'While stocks last.'
    };

    const thumb = imageUrl
        ? `<img src="${imageUrl}" alt="${productName}" width="96" height="96" style="width:96px;height:96px;border-radius:12px;background:#ffffff;border:1px solid #ecedef;object-fit:contain;margin:0 auto;display:block;">`
        : `<div style="width:96px;height:96px;border-radius:12px;background:#ffffff;border:1px solid #ecedef;margin:0 auto;"></div>`;
    const priceBlock = hasDiscount
        ? `<p style="margin:0;font-family:${SANS};font-size:13px;color:#17181c;text-decoration:line-through;">AED ${originalPrice}</p><p style="margin:2px 0 0;font-family:${SANS};font-size:22px;font-weight:800;color:${accent};">AED ${displayPrice}</p>`
        : `<p style="margin:0;font-family:${SANS};font-size:22px;font-weight:800;color:#17181c;">AED ${displayPrice}</p>`;
    const discountBadge = hasDiscount
        ? `<span style="display:inline-block;padding:4px 10px;background:${accent};color:#fff;border-radius:6px;font-family:${SANS};font-size:11px;font-weight:800;letter-spacing:.04em;margin-bottom:10px;">-${discountPct}%</span>`
        : '';

    const content = `
<p style="margin:0 0 14px;font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${accent};">${eyebrow}</p>
<h1 style="margin:0 0 18px;font-family:${SERIF};font-size:34px;line-height:1.16;font-weight:600;letter-spacing:-.01em;color:#17181c;">${L.title}</h1>
<p style="margin:0 0 18px;font-family:${SANS};font-size:15px;line-height:1.65;color:#17181c;">${L.intro}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ecedef;border-radius:14px;overflow:hidden;margin:6px 0 24px;"><tr>
  <td width="180" style="background:#ffffff;padding:0;vertical-align:middle;text-align:center;height:160px;">${thumb}</td>
  <td style="padding:22px 24px;vertical-align:middle;">
    ${discountBadge}
    <p style="margin:0 0 6px;font-family:${SANS};font-size:16px;font-weight:700;color:#17181c;line-height:1.35;">${productName}</p>
    ${priceBlock}
  </td>
</tr></table>
${dsButton(productUrl, L.cta, ar)}
<div style="height:18px;"></div>
<p style="margin:0;text-align:center;font-family:${SANS};font-size:12px;color:#17181c;">${L.note}</p>`;

    try {
        await transporter.sendMail({
            from: `"Best Signature Auto Parts" <${process.env.SMTP_EMAIL}>`,
            to: toEmail,
            subject: `${L.title} | Best Signature Auto Parts`,
            html: dsShell({ ar, preheader: L.title, content }),
            attachments: dsEmailAttachments(ar)
        });
    } catch (error) {
        console.error(`[EMAIL] ❌ Failed to send offer notification to ${toEmail}:`, error.message);
        throw error;
    }
};

/**
 * Send a clean invoice notification email with the invoice PDF as attachment
 */
const sendInvoiceEmail = async (toEmail, userName, invoiceNumber, orderId, totalAmount, items = [], givenByName = '', pdfBuffer = null, locale = 'en') => {
    const transporter = createTransporter();
    const ar = isAr(locale);
    const SITE = process.env.FRONTEND_URL || 'https://bestsignatureautoparts.com';
    const orderSummaryUrl = `${SITE}/${ar ? 'ar' : 'en'}/profile?tab=yourOrders&orderId=${orderId}&view=summary`;

    const invoiceDate = new Date().toLocaleDateString(ar ? 'ar-AE' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const SANS = ar ? DS_SANS_AR : DS_SANS;
    const SERIF = ar ? DS_SERIF_AR : DS_SERIF;
    const endAlign = ar ? 'left' : 'right';
    // VAT-inclusive total → derive the 5% VAT and net subtotal for display.
    const totalNum = Number(totalAmount || 0);
    const subtotalNum = totalNum / 1.05;
    const vatNum = totalNum - subtotalNum;

    const L = ar ? {
        subject: `الفاتورة #${invoiceNumber} — الطلب #${orderId} | ماريوت لمعدات المطابخ`,
        eyebrow: 'فاتورة ضريبية', title: `فاتورة ${invoiceNumber}`, paid: 'مدفوعة',
        billedTo: 'الفاتورة باسم', invoiceNo: 'رقم الفاتورة', orderNo: 'رقم الطلب', issue: 'تاريخ الإصدار',
        desc: 'الوصف', qty: 'الكمية', amount: 'المبلغ',
        subtotal: 'المجموع الفرعي', vatL: 'ضريبة القيمة المضافة (5%)', totalPaid: 'الإجمالي المدفوع',
        cta: 'تحميل الفاتورة PDF',
        attachedNote: 'نسخة من هذه الفاتورة مرفقة بصيغة PDF لسجلاتك.'
    } : {
        subject: `Invoice #${invoiceNumber} — Order #${orderId} | Best Signature New Auto Spare Parts`,
        eyebrow: 'Tax invoice', title: `Invoice ${invoiceNumber}`, paid: 'PAID',
        billedTo: 'Billed to', invoiceNo: 'Invoice #', orderNo: 'Order #', issue: 'Issue date',
        desc: 'Description', qty: 'Qty', amount: 'Amount',
        subtotal: 'Subtotal', vatL: 'VAT (5%)', totalPaid: 'Total paid',
        cta: 'Download PDF invoice',
        attachedNote: 'A copy of this invoice is attached as a PDF for your records.'
    };

    const itemRows = (items || []).map(item => {
        const itemName = (ar && item.name_ar) ? item.name_ar : (item.name || '');
        const qty = item.quantity || 1;
        const amount = Number((item.price_at_purchase || item.price || 0) * qty).toFixed(2);
        return `<tr><td style="padding:11px 0;border-bottom:1px solid #ecedef;font-family:${SANS};font-size:13px;color:#17181c;">${itemName}</td><td align="center" style="padding:11px 0;border-bottom:1px solid #ecedef;font-family:${SANS};font-size:13px;color:#17181c;">${qty}</td><td align="${endAlign}" style="padding:11px 0;border-bottom:1px solid #ecedef;font-family:${SANS};font-size:13px;font-weight:600;color:#17181c;">AED ${amount}</td></tr>`;
    }).join('');

    const content = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;"><tr>
  <td style="vertical-align:top;"><p style="margin:0 0 14px;font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#1488c0;">${L.eyebrow}</p><h1 style="margin:0;font-family:${SERIF};font-size:31px;font-weight:600;letter-spacing:-.01em;color:#17181c;">${L.title}</h1></td>
  <td align="${endAlign}" style="vertical-align:top;"><span style="display:inline-block;padding:7px 14px;background:#ecfdf5;color:#10b981;border-radius:999px;font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:.04em;">${L.paid}</span></td>
</tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #ecedef;border-radius:12px;margin-bottom:24px;"><tr>
  <td style="padding:16px 18px;vertical-align:top;width:50%;border-${ar ? 'left' : 'right'}:1px solid #ecedef;">
    <p style="margin:0 0 8px;font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#17181c;">${L.billedTo}</p>
    <p style="margin:0;font-family:${SANS};font-size:13px;line-height:1.7;color:#17181c;">${userName || (ar ? 'عميلنا العزيز' : 'Customer')}</p>
  </td>
  <td style="padding:16px 18px;vertical-align:top;width:50%;font-family:${SANS};font-size:13px;line-height:1.9;color:#17181c;">
    <span style="color:#17181c;">${L.invoiceNo}</span> <strong style="color:#17181c;">${invoiceNumber}</strong><br>
    <span style="color:#17181c;">${L.orderNo}</span> <strong style="color:#17181c;">${orderId}</strong><br>
    <span style="color:#17181c;">${L.issue}</span> <strong style="color:#17181c;">${invoiceDate}</strong>
  </td>
</tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px;"><tr>
  <td style="padding:0 0 8px;font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#17181c;border-bottom:2px solid #ecedef;">${L.desc}</td>
  <td align="center" style="padding:0 0 8px;font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#17181c;border-bottom:2px solid #ecedef;">${L.qty}</td>
  <td align="${endAlign}" style="padding:0 0 8px;font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#17181c;border-bottom:2px solid #ecedef;">${L.amount}</td>
</tr>${itemRows}</table>
<table role="presentation" width="60%" cellpadding="0" cellspacing="0" align="${endAlign}" style="margin-top:14px;">
  <tr><td style="padding:6px 0;font-family:${SANS};font-size:13px;font-weight:400;color:#17181c;">${L.subtotal}</td><td align="${endAlign}" style="padding:6px 0;font-family:${SANS};font-size:13px;font-weight:600;color:#17181c;">AED ${subtotalNum.toFixed(2)}</td></tr>
  <tr><td style="padding:6px 0;font-family:${SANS};font-size:13px;font-weight:400;color:#17181c;">${L.vatL}</td><td align="${endAlign}" style="padding:6px 0;font-family:${SANS};font-size:13px;font-weight:600;color:#17181c;">AED ${vatNum.toFixed(2)}</td></tr>
  <tr><td colspan="2" style="border-top:2px solid #ecedef;padding-top:6px;"></td></tr>
  <tr><td style="padding:6px 0;font-family:${SANS};font-size:15px;font-weight:700;color:#17181c;">${L.totalPaid}</td><td align="${endAlign}" style="padding:6px 0;font-family:${SANS};font-size:18px;font-weight:800;color:#10b981;">AED ${totalNum.toFixed(2)}</td></tr>
</table>
<div style="clear:both;height:30px;"></div>
${dsButton(orderSummaryUrl, L.cta, ar)}
<div style="height:20px;"></div>
<p style="margin:0;text-align:center;font-family:${SANS};font-size:12px;color:#17181c;">${L.attachedNote}</p>`;

    const invoicePdfAttachment = pdfBuffer ? [{
        filename: `Invoice-${invoiceNumber}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
    }] : [];

    const mailOptions = {
        from: `"Best Signature New Auto Spare Parts" <${process.env.SMTP_EMAIL}>`,
        to: toEmail,
        subject: L.subject,
        html: dsShell({ ar, preheader: `${L.title} — AED ${totalNum.toFixed(2)} ${ar ? 'مدفوعة' : 'paid'}`, content }),
        attachments: [...invoicePdfAttachment, ...dsEmailAttachments(ar)]
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`[EMAIL] ✅ Invoice email sent to ${toEmail}${pdfBuffer ? ' (with PDF)' : ''}`);
    } catch (error) {
        console.error(`[EMAIL] ❌ Failed to send invoice email to ${toEmail}:`, error.message);
        throw error;
    }
};

/**
 * Send an account verification OTP email.
 * @param {string} toEmail - Recipient email
 * @param {string} userName - User's display name (may be blank)
 * @param {string} otp - 6-digit OTP code
 * @param {object} [opts]
 * @param {string} [opts.purpose] - "signup" | "email-change" (controls heading copy)
 */
const sendOtpEmail = async (toEmail, userName, otp, opts = {}) => {
    const purpose = opts.purpose || 'signup';
    const ar = isAr(opts.locale);
    const transporter = createTransporter();
    const firstName = (userName || '').split(' ')[0] || '';
    const digits = String(otp).split('');
    const helpCentreUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/${ar ? 'ar' : 'en'}/contact`;

    const SANS = ar ? DS_SANS_AR : DS_SANS;
    const SERIF = ar ? DS_SERIF_AR : DS_SERIF;
    // Display the code in readable groups (e.g. 6 digits → "284 915").
    const codeDisplay = String(otp).length === 6 ? `${String(otp).slice(0, 3)} ${String(otp).slice(3)}` : String(otp);
    const L = ar ? {
        subject: purpose === 'email-change' ? `ماريوت — تأكيد بريدك الإلكتروني الجديد (${otp})` : `ماريوت — رمز التحقق الخاص بك (${otp})`,
        preheader: `رمز التحقق الخاص بك في ماريوت هو ${codeDisplay}.`,
        eyebrow: purpose === 'email-change' ? 'تأكيد البريد الإلكتروني' : 'تأكيد بريدك الإلكتروني',
        title: purpose === 'email-change' ? 'أكّد بريدك الإلكتروني الجديد' : 'تأكّد أنه أنت فعلاً',
        intro: 'أدخل رمز التحقق أدناه لإكمال إعداد حسابك في ماريوت. الرمز صالح خلال الدقائق الخمس القادمة.',
        codeLabel: 'رمز التحقق الخاص بك',
        warn: 'تنتهي صلاحية هذا الرمز خلال 5 دقائق.',
        ignore: 'إذا لم تطلب هذا الرمز، يمكنك تجاهل هذه الرسالة بأمان — لا يمكن لأحد الوصول إلى حسابك بدون الرمز. لا تشاركه مع أي أحد، بما في ذلك موظفو ماريوت.',
        textBody: `مرحباً${firstName ? ' ' + firstName : ''}،\n\nرمز التحقق لمرة واحدة (OTP) الخاص بك في ماريوت هو: ${otp}\n\nتنتهي صلاحية هذا الرمز خلال 5 دقائق.\n\nإذا لم تطلب ذلك، يمكنك تجاهل هذا البريد.\n\n— فريق ماريوت`
    } : {
        subject: purpose === 'email-change' ? `Best Signature — Verify your new email (${otp})` : `Best Signature — Your verification code (${otp})`,
        preheader: `Your Best Signature verification code is ${codeDisplay}.`,
        eyebrow: purpose === 'email-change' ? 'Verify your email' : 'Verify your email',
        title: purpose === 'email-change' ? 'Confirm your new email' : "Confirm it's really you",
        intro: 'Enter the verification code below to finish setting up your Best Signature account. The code is valid for the next 5 minutes.',
        codeLabel: 'Your verification code',
        warn: 'This code expires in 5 minutes.',
        ignore: "If you didn't request this, you can safely ignore this email — nobody can access your account without the code. Never share it with anyone, including Best Signature staff.",
        textBody: `Hi${firstName ? ' ' + firstName : ''},\n\nYour Best Signature one-time password (OTP) is: ${otp}\n\nThis code expires in 5 minutes.\n\nIf you didn't request this, you can safely ignore this email.\n\n— Team Best Signature`
    };

    const content = `
<p style="margin:0 0 14px;font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#1488c0;">${L.eyebrow}</p>
<h1 style="margin:0 0 18px;font-family:${SERIF};font-size:34px;line-height:1.16;font-weight:600;letter-spacing:-.01em;color:#17181c;">${L.title}</h1>
<p style="margin:0 0 18px;font-family:${SANS};font-size:15px;line-height:1.65;color:#17181c;">${L.intro}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 22px;"><tr><td align="center" style="background:#ffffff;border:1px solid #e9e7e2;border-radius:14px;padding:26px 20px;">
  <p style="margin:0 0 8px;font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#1488c0;">${L.codeLabel}</p>
  <p dir="ltr" style="margin:0;font-family:${SANS};font-size:40px;font-weight:800;letter-spacing:.18em;color:#17181c;">${codeDisplay}</p>
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;"><tr><td style="background:#fff7ed;border-radius:10px;padding:13px 16px;">
  <p style="margin:0;font-family:${SANS};font-size:13px;font-weight:600;color:#9a3412;">${L.warn}</p>
</td></tr></table>
<p style="margin:0;font-family:${SANS};font-size:15px;line-height:1.65;color:#17181c;">${L.ignore}</p>`;

    const mailOptions = {
        from: `"Best Signature Auto Parts" <${process.env.SMTP_EMAIL}>`,
        to: toEmail,
        subject: L.subject,
        text: L.textBody,
        html: dsShell({ ar, preheader: L.preheader, content }),
        attachments: dsEmailAttachments(ar)
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`[EMAIL] ✅ OTP email sent to ${toEmail}`);
    } catch (error) {
        console.error(`[EMAIL] ❌ Failed to send OTP email to ${toEmail}:`, error.message);
        throw error;
    }
};

/**
 * Monthly reward-points e-statement. Sent on the 1st of each month, summarizing
 * the previous calendar month's points activity.
 * @param {string} toEmail
 * @param {string} userName
 * @param {object} stats { earned, pending, redeemed, expiringNextMonth, balance, monthLabel, monthLabelAr }
 * @param {string} locale 'en' | 'ar'
 */
const sendMonthlyStatementEmail = async (toEmail, userName, stats = {}, locale = 'en') => {
    const transporter = createTransporter();
    const ar = isAr(locale);
    const SITE = process.env.FRONTEND_URL || 'https://bestsignatureautoparts.com';
    const rewardsUrl = `${SITE}/${ar ? 'ar' : 'en'}/profile?tab=myRewards`;

    const firstName = String(userName || '').split(' ')[0] || (ar ? 'عميلنا' : 'there');
    const fmt = (n) => Number(n || 0).toLocaleString(ar ? 'ar-EG' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtInt = (n) => Number(n || 0).toLocaleString(ar ? 'ar-EG' : 'en-US');
    const month = ar ? (stats.monthLabelAr || stats.monthLabel) : stats.monthLabel;

    const SANS = ar ? DS_SANS_AR : DS_SANS;
    const SERIF = ar ? DS_SERIF_AR : DS_SERIF;
    const monthLabel = month || (ar ? 'هذا الشهر' : 'this month');
    const L = ar ? {
        subject: `كشف نقاط مكافآتك — ${monthLabel}`,
        preheader: `ملخص نقاط مكافآت ماريوت لشهر ${monthLabel} جاهز.`,
        eyebrow: 'ملخصك الشهري',
        title: `${monthLabel} باختصار`,
        intro: `إليك لمحة سريعة عن نشاط مكافآت ماريوت الخاص بك هذا الشهر، ${firstName}.`,
        opening: 'الرصيد الافتتاحي', earned: 'إجمالي النقاط المكتسبة', redeemed: 'النقاط المستبدلة', balance: 'رصيد النقاط',
        expiringTitle: (n) => `${n} نقطة تنتهي صلاحيتها الشهر القادم`,
        expiringSub: 'استبدلها قبل انتهائها لتحقيق أقصى استفادة.',
        colActivity: 'النشاط', colPoints: 'النقاط',
        cta: 'عرض حسابي',
        note: 'يُرسل هذا الكشف تلقائياً في أول كل شهر.',
    } : {
        subject: `Your rewards statement — ${monthLabel}`,
        preheader: `Your Best Signature ${monthLabel} rewards summary is ready.`,
        eyebrow: 'Your monthly summary',
        title: `${monthLabel} at a glance`,
        intro: `Here's a snapshot of your Best Signature rewards activity this month, ${firstName}.`,
        opening: 'Opening balance', earned: 'Total points earned', redeemed: 'Points redeemed', balance: 'Points balance',
        expiringTitle: (n) => `${n} points expiring next month`,
        expiringSub: 'Redeem them before they expire to make the most of your rewards.',
        colActivity: 'Activity', colPoints: 'Points',
        cta: 'View my account',
        note: 'This statement is sent automatically on the first of every month.',
    };

    const startAlign = ar ? 'right' : 'left';
    const endAlign = ar ? 'left' : 'right';

    // One statement row. opts.emphasis styles the closing balance distinctly;
    // opts.sign prefixes a +/− so the table reads like a real statement
    // (opening + earned − redeemed = balance); opts.color overrides the figure colour.
    const row = (label, value, opts = {}) => {
        const { emphasis = false, sign = '', color } = opts;
        const valColor = color || (emphasis ? '#1488c0' : '#17181c');
        const bg = emphasis ? 'background:#f6fafd;' : '';
        return `<tr>
  <td align="${startAlign}" style="padding:14px 20px;border-top:1px solid #ecedef;font-family:${SANS};font-size:14px;font-weight:${emphasis ? 700 : 400};color:#17181c;${bg}">${label}</td>
  <td align="${endAlign}" dir="ltr" style="padding:14px 20px;border-top:1px solid #ecedef;font-family:${SANS};font-size:${emphasis ? 18 : 15}px;font-weight:${emphasis ? 800 : 600};color:${valColor};${bg}">${sign}${value}</td>
</tr>`;
    };

    const statementTable = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 8px;border:1px solid #ecedef;border-radius:12px;border-collapse:separate;overflow:hidden;">
  <tr>
    <td align="${startAlign}" style="padding:12px 20px;background:#17181c;font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#ffffff;">${L.colActivity}</td>
    <td align="${endAlign}" style="padding:12px 20px;background:#17181c;font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#ffffff;">${L.colPoints}</td>
  </tr>
  ${row(L.opening, fmtInt(stats.opening))}
  ${row(L.earned, fmtInt(stats.earned), { sign: '+ ', color: '#1a7f4f' })}
  ${row(L.redeemed, fmtInt(stats.redeemed), { sign: '− ' })}
  ${row(L.balance, fmtInt(stats.balance), { emphasis: true })}
</table>`;

    const expiringNum = Number(stats.expiringNextMonth || 0);
    const expiringBand = expiringNum > 0 ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 24px;"><tr><td style="background:#ffffff;border-radius:12px;padding:16px 18px;">
  <p style="margin:0 0 2px;font-family:${SANS};font-size:13px;font-weight:700;color:#17181c;">${L.expiringTitle(fmtInt(expiringNum))}</p>
  <p style="margin:0;font-family:${SANS};font-size:13px;color:#1488c0;">${L.expiringSub}</p>
</td></tr></table>` : '<div style="height:6px;"></div>';

    const content = `
<p style="margin:0 0 14px;font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#1488c0;">${L.eyebrow}</p>
<h1 style="margin:0 0 18px;font-family:${SERIF};font-size:34px;line-height:1.16;font-weight:600;letter-spacing:-.01em;color:#17181c;">${L.title}</h1>
<p style="margin:0 0 18px;font-family:${SANS};font-size:15px;line-height:1.65;color:#17181c;">${L.intro}</p>
${statementTable}
${expiringBand}
${dsButton(rewardsUrl, L.cta, ar)}
<div style="height:18px;"></div>
<p style="margin:0;text-align:center;font-family:${SANS};font-size:12px;color:#17181c;">${L.note}</p>`;

    const mailOptions = {
        from: `"Best Signature Auto Parts" <${process.env.SMTP_EMAIL}>`,
        to: toEmail,
        subject: L.subject,
        html: dsShell({ ar, preheader: L.preheader, content }),
        attachments: dsEmailAttachments(ar)
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`[EMAIL] ✅ Monthly statement sent to ${toEmail}`);
    } catch (error) {
        console.error(`[EMAIL] ❌ Failed to send monthly statement to ${toEmail}:`, error.message);
        throw error;
    }
};

/**
 * Back-in-stock alert for a watched product (DS "Back in stock" design).
 * @param {string} toEmail
 * @param {{ name, name_ar, slug, price, image, variantLabel }} product
 * @param {string} locale 'en' | 'ar'
 */
const sendBackInStockEmail = async (toEmail, product = {}, locale = 'en') => {
    const transporter = createTransporter();
    const ar = isAr(locale);
    const SITE = process.env.FRONTEND_URL || 'https://bestsignatureautoparts.com';
    const SANS = ar ? DS_SANS_AR : DS_SANS;
    const SERIF = ar ? DS_SERIF_AR : DS_SERIF;
    const productName = (ar && product.name_ar) ? product.name_ar : (product.name || '');
    const productUrl = `${SITE}/${ar ? 'ar' : 'en'}/product/${product.slug || ''}`;
    const variantLabel = product.variantLabel || '';
    const headline = variantLabel ? `${productName} — ${variantLabel}` : productName;
    const priceTxt = product.price ? `AED ${Number(product.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';

    const L = ar ? {
        subject: `عاد إلى المخزون: ${headline}`,
        eyebrow: 'عاد إلى المخزون', title: 'أصبح متوفراً من جديد',
        intro: 'أخبار جيدة — منتج كنت تنتظره عاد إلى المخزون. اطلبه الآن قبل نفاده مجدداً.',
        inStock: 'متوفر', cta: 'اشترِ الآن', note: 'لقد طلبت أن نخبرك عند توفر هذا المنتج.'
    } : {
        subject: `Back in stock: ${headline}`,
        eyebrow: 'Back in stock', title: "It's available again",
        intro: 'Good news — an item you wanted is back in stock. Order now before it sells out again.',
        inStock: 'IN STOCK', cta: 'Buy it now', note: 'You asked to be notified when this product became available.'
    };

    const bisImg = absolutizeEmailImage(product.image);
    const thumb = bisImg
        ? `<img src="${bisImg}" alt="${productName}" width="90" height="90" style="width:90px;height:90px;border-radius:12px;background:#ffffff;border:1px solid #ecedef;object-fit:contain;margin:0 auto;display:block;">`
        : `<div style="width:90px;height:90px;border-radius:12px;background:#ffffff;border:1px solid #ecedef;margin:0 auto;"></div>`;

    const content = `
<p style="margin:0 0 14px;font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#10b981;">${L.eyebrow}</p>
<h1 style="margin:0 0 18px;font-family:${SERIF};font-size:34px;line-height:1.16;font-weight:600;letter-spacing:-.01em;color:#17181c;">${L.title}</h1>
<p style="margin:0 0 18px;font-family:${SANS};font-size:15px;line-height:1.65;color:#17181c;">${L.intro}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ecedef;border-radius:14px;overflow:hidden;margin:6px 0 24px;"><tr>
  <td width="160" style="background:#ffffff;vertical-align:middle;text-align:center;height:150px;">${thumb}</td>
  <td style="padding:22px 24px;vertical-align:middle;">
    <span style="display:inline-block;padding:4px 10px;background:#ecfdf5;color:#10b981;border-radius:6px;font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:.04em;margin-bottom:10px;">${L.inStock}</span>
    <p style="margin:0 0 6px;font-family:${SANS};font-size:16px;font-weight:700;color:#17181c;line-height:1.35;">${headline}</p>
    ${priceTxt ? `<p style="margin:0;font-family:${SANS};font-size:20px;font-weight:800;color:#17181c;">${priceTxt}</p>` : ''}
  </td>
</tr></table>
${dsButton(productUrl, L.cta, ar)}
<div style="height:18px;"></div>
<p style="margin:0;text-align:center;font-family:${SANS};font-size:12px;color:#17181c;">${L.note}</p>`;

    await transporter.sendMail({
        from: `"Best Signature Auto Parts" <${process.env.SMTP_EMAIL}>`,
        to: toEmail,
        subject: L.subject,
        html: dsShell({ ar, preheader: L.subject, content }),
        attachments: dsEmailAttachments(ar)
    });
    console.log(`[EMAIL] ✅ Back-in-stock email sent to ${toEmail}`);
};

/**
 * Review-request email — sent after an order is delivered, inviting the customer to
 * review the product(s) they purchased. Each product shows its image + title and a
 * "Write a review" button that links straight to that product's review section
 * (/[locale]/product/<slug>#reviews-section). Works for one product or many. EN/AR.
 *
 * @param {string} toEmail
 * @param {string} userName
 * @param {Array<{name, name_ar, slug, image|primaryImage|image_url}>} products
 * @param {string} orderId  (optional — used only in the preheader/subject context)
 * @param {string} locale   'en' | 'ar'
 */
const sendReviewRequestEmail = async (toEmail, userName, products = [], orderId = '', locale = 'en') => {
    const transporter = createTransporter();
    const ar = isAr(locale);
    const SITE = process.env.FRONTEND_URL || 'https://bestsignatureautoparts.com';
    const SANS = ar ? DS_SANS_AR : DS_SANS;
    const SERIF = ar ? DS_SERIF_AR : DS_SERIF;

    // Keep only renderable products (need a slug to link to). De-dupe by slug so the
    // same product bought twice in one order doesn't appear as two review cards.
    const seen = new Set();
    const list = (Array.isArray(products) ? products : []).filter(p => {
        if (!p || !p.slug || seen.has(p.slug)) return false;
        seen.add(p.slug);
        return true;
    });
    if (list.length === 0) return; // nothing reviewable
    const multi = list.length > 1;

    const L = ar ? {
        eyebrow: 'تم توصيل طلبك',
        title: multi ? 'كيف كانت منتجاتك؟' : 'كيف كان منتجك؟',
        intro: 'نأمل أن تكون راضياً عن مشترياتك. شاركنا رأيك — تقييمك يساعد طهاة آخرين على الاختيار بثقة.',
        cta: 'اكتب تقييماً',
        note: 'يستغرق الأمر أقل من دقيقة. شكراً لاختيارك ماريوت.'
    } : {
        eyebrow: 'Your order was delivered',
        title: multi ? 'How were your products?' : 'How was your product?',
        intro: "We hope you're enjoying your purchase. Share your experience — your review helps other chefs buy with confidence.",
        cta: 'Write a review',
        note: 'It takes less than a minute. Thank you for choosing Best Signature.'
    };

    // Small dark pill button used per product (matches dsButton styling, smaller).
    const reviewBtn = (href, label) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0;"><tr><td style="border-radius:8px;background:#17181c;"><a href="${href}" style="display:inline-block;padding:10px 22px;font-family:${SANS};font-size:13px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;letter-spacing:.01em;">${label}</a></td></tr></table>`;

    const productRows = list.map(p => {
        const name = (ar && p.name_ar) ? p.name_ar : (p.name || '');
        const url = `${SITE}/${ar ? 'ar' : 'en'}/product/${p.slug}#reviews-section`;
        const img = absolutizeEmailImage(p.primaryImage || p.image || p.image_url);
        const thumb = img
            ? `<img src="${img}" alt="${String(name).replace(/"/g, '&quot;')}" width="72" height="72" style="width:72px;height:72px;border-radius:10px;object-fit:contain;background:#ffffff;border:1px solid #ecedef;display:block;">`
            : `<div style="width:72px;height:72px;border-radius:10px;background:#ffffff;border:1px solid #ecedef;"></div>`;
        return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ecedef;border-radius:14px;margin:0 0 14px;"><tr>
  <td width="88" style="padding:16px;vertical-align:middle;">${thumb}</td>
  <td style="padding:16px;vertical-align:middle;">
    <p style="margin:0 0 12px;font-family:${SANS};font-size:15px;font-weight:600;color:#17181c;line-height:1.4;">${name}</p>
    ${reviewBtn(url, L.cta)}
  </td>
</tr></table>`;
    }).join('');

    const content = `
<p style="margin:0 0 14px;font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#19489D;">${L.eyebrow}</p>
<h1 style="margin:0 0 16px;font-family:${SERIF};font-size:32px;line-height:1.16;font-weight:600;letter-spacing:-.01em;color:#17181c;">${L.title}</h1>
<p style="margin:0 0 26px;font-family:${SANS};font-size:15px;line-height:1.65;color:#17181c;">${L.intro}</p>
${productRows}
<div style="height:8px;"></div>
<p style="margin:0;font-family:${SANS};font-size:12px;color:#17181c;">${L.note}</p>`;

    const subject = ar
        ? `${L.title} شاركنا تقييمك — متجر ماريوت`
        : `${L.title} Leave a quick review — Best Signature Auto Parts`;

    try {
        await transporter.sendMail({
            from: `"Best Signature Auto Parts" <${process.env.SMTP_EMAIL}>`,
            to: toEmail,
            subject,
            html: dsShell({ ar, preheader: L.title, content }),
            attachments: dsEmailAttachments(ar)
        });
        console.log(`[EMAIL] ✅ Review request email sent to ${toEmail}`);
    } catch (error) {
        console.error(`[EMAIL] ❌ Failed to send review request to ${toEmail}:`, error.message);
        throw error;
    }
};

module.exports = {
    sendPasswordResetEmail,
    sendOrderConfirmationEmail,
    sendOrderStatusUpdateEmail,
    sendAbandonedCartEmail,
    sendWelcomeEmail,
    verifySmtpConnection,
    sendQuotationEmail,
    sendEmail,
    sendOfferNotificationEmail,
    sendInvoiceEmail,
    sendOtpEmail,
    sendMonthlyStatementEmail,
    sendBackInStockEmail,
    sendReviewRequestEmail
};

