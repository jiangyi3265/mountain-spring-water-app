// Physical pixels from the device API, independent of rpx scaling.
export function navigationMetrics(windowInfo = {}, capsule = null, native = false) {
	if (!native) return { statusHeight: 0, navHeight: 44, headerHeight: 44, sideWidth: 52 }
	const width = Number(windowInfo.windowWidth) || 375
	const reportedStatusHeight = Number(windowInfo.statusBarHeight)
	const statusHeight = Number.isFinite(reportedStatusHeight) ? Math.max(0, reportedStatusHeight) : 20
	const top = Number(capsule?.top)
	const height = Number(capsule?.height)
	const left = Number(capsule?.left)
	const valid = top >= statusHeight && top - statusHeight <= 40 && height >= 24 && height <= 48 && left > width / 2 && left < width
	const navHeight = valid ? height + (top - statusHeight) * 2 : 44
	return { statusHeight, navHeight, headerHeight: statusHeight + navHeight, sideWidth: valid ? width - left + 8 : 104 }
}
