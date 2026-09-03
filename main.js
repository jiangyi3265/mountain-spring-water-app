import App from './App.vue'

// #ifndef VUE3
// @ts-expect-error uni-app 会在 Vue 3 构建时剪掉 Vue 2 条件编译分支
import Vue from 'vue'
import './uni.promisify.adaptor'
Vue.config.productionTip = false
App.mpType = 'app'
const app = new Vue({
	...App
})
app.$mount()
// #endif

// #ifdef VUE3
import {
	createSSRApp
} from 'vue'
export function createApp() {
	const app = createSSRApp(App)
	return {
		app
	}
}
// #endif
