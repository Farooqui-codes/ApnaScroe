const fs = require('fs');
const crypto = require('crypto');
const config = require('../config/env');

function isCloudinaryConfigured() {
  return Boolean(config.cloudinaryCloudName && config.cloudinaryApiKey && config.cloudinaryApiSecret);
}

/**
 * Stores an uploaded image on Cloudinary in production (when configured),
 * falling back to safe local /assets/uploads/ path in local/dev environments.
 */
async function storeUploadedImage(file, folder = 'apnascore/profiles') {
  if (!file) return '';
  if (!isCloudinaryConfigured()) {
    return `/assets/uploads/${file.filename}`;
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const paramsToSign = `folder=${folder}&timestamp=${timestamp}${config.cloudinaryApiSecret}`;
    const signature = crypto.createHash('sha1').update(paramsToSign).digest('hex');

    const fileBytes = fs.readFileSync(file.path);
    const blob = new Blob([fileBytes], { type: file.mimetype || 'image/webp' });
    const fd = new FormData();
    fd.append('file', blob, file.filename);
    fd.append('api_key', config.cloudinaryApiKey);
    fd.append('timestamp', String(timestamp));
    fd.append('folder', folder);
    fd.append('signature', signature);

    const res = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudinaryCloudName}/image/upload`, {
      method: 'POST',
      body: fd
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.secure_url) {
      fs.unlink(file.path, () => {});
      return data.secure_url;
    }
  } catch (_) {
    // Fallback to local file path if external upload fails transiently
  }
  return `/assets/uploads/${file.filename}`;
}

module.exports = {
  isCloudinaryConfigured,
  storeUploadedImage
};
