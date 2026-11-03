// 微信小程序的 showActionSheet 最多 6 项（H5 实现没有这个限制），超过时直接失败、页面没有任何反应。
// 选项多于 6 个时分页显示：每页 5 项加“更多…”，最后一页最多 6 项。返回所选项在原列表中的下标，取消返回 -1；
// 其他失败以错误返回，由页面提示，不再静默。
export const ACTION_SHEET_LIMIT = 6
export const MORE_LABEL = '更多…'

/**
 * @param {unknown[]} items
 * @param {{ sheet?: (options: { itemList: string[], success: (res: { tapIndex: number }) => void, fail: (error: { errMsg?: string }) => void }) => void }} [options]
 * @returns {Promise<number>}
 */
export function chooseFromList(items, { sheet = options => uni.showActionSheet(options) } = {}) {
	const list = Array.isArray(items) ? items.map(item => String(item)) : []
	return new Promise((resolve, reject) => {
		if (!list.length) return resolve(-1)
		/** @param {number} start */
		const showPage = start => {
			const rest = list.length - start
			const count = rest <= ACTION_SHEET_LIMIT ? rest : ACTION_SHEET_LIMIT - 1
			const more = start + count < list.length
			const itemList = [...list.slice(start, start + count), ...(more ? [MORE_LABEL] : [])]
			sheet({
				itemList,
				success: res => {
					const index = Number(res.tapIndex)
					if (more && index === count) return showPage(start + count)
					resolve(start + index)
				},
				fail: error => {
					if (/cancel/i.test(String(error?.errMsg || ''))) return resolve(-1)
					reject(Object.assign(new Error('选项打开失败，请重试'), { cause: error }))
				},
			})
		}
		showPage(0)
	})
}
