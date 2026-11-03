// 小程序端图片的两处平台差异：
// 1. 单次 setData 上限约 1MB，大图的 base64 data URL 直接放进视图会显示失败；previewImage 也不支持 data: 地址。
//    小程序里先写成本地临时文件，再用文件路径显示和预览（H5 仍直接使用 data URL）。
// 2. 上传接口限制 2MB，部分机型选“压缩图”后仍超过；超过阈值时先用 compressImage 再压一次。

export const UPLOAD_SOFT_LIMIT = 1.8 * 1024 * 1024

/** @param {string} value */
function shortHash(value) {
	let hash = 5381
	for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0
	return hash.toString(16)
}

/** @returns {any} */
function fileSystem() {
	return typeof uni.getFileSystemManager === 'function' ? uni.getFileSystemManager() : null
}

/**
 * 把附件的 data URL 转成可显示、可预览的地址。小程序返回本地文件路径（写入失败时退回 data URL），其他平台原样返回。
 * @param {string} dataUrl @param {string} key 用于生成文件名（由调用方保证唯一，卸载时删除）
 * @returns {Promise<{ src: string, tempFile: string }>}
 */
export function toDisplaySource(dataUrl, key) {
	const src = String(dataUrl || '')
	let base = ''
	// #ifdef MP-WEIXIN
	base = /** @type {any} */ (globalThis).wx?.env?.USER_DATA_PATH || ''
	// #endif
	const fs = base ? fileSystem() : null
	const comma = src.indexOf(',')
	if (!fs || !src.startsWith('data:') || comma < 0) return Promise.resolve({ src, tempFile: '' })
	const mime = src.slice(5, comma).split(';')[0]
	const ext = ({ 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' })[mime] || 'jpg'
	const filePath = `${base}/attachment-${shortHash(String(key || src.slice(0, 256)))}.${ext}`
	return new Promise(resolve => {
		fs.writeFile({ filePath, data: src.slice(comma + 1), encoding: 'base64',
			success: () => resolve({ src: filePath, tempFile: filePath }),
			fail: () => resolve({ src, tempFile: '' }) })
	})
}

/** 启动时清理上次运行残留的附件文件（进程被系统结束时来不及在组件卸载时删除）。 */
export function cleanupDisplaySources() {
	let base = ''
	// #ifdef MP-WEIXIN
	base = /** @type {any} */ (globalThis).wx?.env?.USER_DATA_PATH || ''
	// #endif
	const fs = base ? fileSystem() : null
	if (!fs) return
	fs.readdir({ dirPath: base, success: (/** @type {{ files?: string[] }} */ result) => {
		for (const name of result.files || []) if (/^attachment-[0-9a-f]+\.(jpg|png|webp|gif)$/.test(name)) fs.unlink({ filePath: `${base}/${name}`, fail: () => {} })
	}, fail: () => {} })
}

/** 删除 toDisplaySource 写出的临时文件（本地用户目录空间有限）。 @param {string} tempFile */
export function removeDisplaySource(tempFile) {
	const fs = tempFile ? fileSystem() : null
	if (fs) fs.unlink({ filePath: tempFile, fail: () => {} })
}

/**
 * 选中的图片超过上传软上限时先压缩；不支持压缩或压缩失败时返回原路径，由上传环节给出明确的大小提示。
 * @param {string} path @param {number} [size]
 * @returns {Promise<string>}
 */
export function compressIfLarge(path, size) {
	if (!path || !(Number(size) > UPLOAD_SOFT_LIMIT) || typeof uni.compressImage !== 'function') return Promise.resolve(path)
	return new Promise(resolve => {
		uni.compressImage({ src: path, quality: 60, success: result => resolve(result.tempFilePath || path), fail: () => resolve(path) })
	})
}
