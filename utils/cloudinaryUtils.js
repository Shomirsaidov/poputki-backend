const { v2: cloudinary } = require('cloudinary');

/**
 * Uploads a base64 encoded image to Cloudinary.
 * @param {string} fileBase64 - Base64 data URI of the file.
 * @param {object} options - Cloudinary upload options (e.g., folder).
 * @returns {Promise<object>} - Result from Cloudinary including url and public_id.
 */
function uploadToCloudinary(fileBase64, options = {}) {
    return new Promise((resolve, reject) => {
        cloudinary.uploader.upload(fileBase64, options, (error, result) => {
            if (error) {
                return reject(error);
            }
            resolve({
                url: result.secure_url,
                public_id: result.public_id
            });
        });
    });
}

/**
 * Deletes a file from Cloudinary given its public_id.
 * @param {string} publicId - Cloudinary public ID.
 * @returns {Promise<any>}
 */
function deleteFromCloudinary(publicId) {
    return new Promise((resolve, reject) => {
        cloudinary.uploader.destroy(publicId, { resource_type: 'image' }, (error, result) => {
            if (error) {
                console.error(`[Cloudinary] Delete error for ${publicId}:`, error);
                return resolve(false); // don't reject to avoid breaking updates
            }
            resolve(result);
        });
    });
}

module.exports = {
    uploadToCloudinary,
    deleteFromCloudinary
};
