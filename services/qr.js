import qrcode from 'qrcode-generator'

/**
 * 使用标准 QR Code Byte 编码生成模块矩阵，并在四周保留规范要求的 4 模块静区。
 * 该矩阵只包含布尔值，因此可以由 uni-app 的 view 网格在 H5 与小程序端一致渲染。
 *
 * @param {string} text
 * @returns {boolean[][]}
 */
export function encodeQr(text) {
	const value = String(text ?? '')
	if (!value) throw new Error('二维码内容不能为空')
	// 签收码固定 6 位；版本 2 + M 级纠错在手机相机下比最小版本更易识别。
	const code = qrcode(2, 'M')
	code.addData(value, 'Byte')
	code.make()
	const modules = code.getModuleCount()
	const quietZone = 4
	const size = modules + quietZone * 2
	return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => {
		const sourceRow = row - quietZone
		const sourceColumn = column - quietZone
		return sourceRow >= 0 && sourceColumn >= 0 && sourceRow < modules && sourceColumn < modules
			? code.isDark(sourceRow, sourceColumn)
			: false
	}))
}
