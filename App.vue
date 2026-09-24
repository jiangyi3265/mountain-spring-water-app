<script>
	export default {
		onLaunch() {},
		onShow() {},
		onHide() {}
	}
</script>

<style>
	page {
		min-height: 100%;
		background: #f3f6f3;
		color: #17342c;
		font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
		font-size: 28rpx;
		-webkit-font-smoothing: antialiased;
	}

	view, text, image, scroll-view, button, input, textarea {
		box-sizing: border-box;
	}

	button::after {
		border: 0;
	}

	button {
		font-family: inherit;
		transition: transform .16s ease, filter .16s ease, box-shadow .16s ease;
	}

	button:active { transform: scale(.985); filter: brightness(.96); }
	scroll-view::-webkit-scrollbar, ::-webkit-scrollbar { width: 0; height: 0; display: none; }
	.ui-strong, .ui-bold, [class*="price"], [class*="amount"], [class*="count"] { font-variant-numeric: tabular-nums; }

	text { line-height: 1.42; }
	.ui-strong { font-weight: 650; }
	.ui-bold { font-weight: 650; }
	.ui-small { color: #6f807a; font-size:max(12px, 22rpx); }
	.ui-paragraph { display: block; }
	.ui-i { font-style: normal; }
</style>
