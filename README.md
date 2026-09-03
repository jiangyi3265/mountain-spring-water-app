# 山泉到家用户端与送水员端

山泉到家桶装水配送系统的 uni-app 客户端，同时提供用户订水、会员服务和送水员履约工作台。

## 项目简介

用户侧包含商品分类与搜索、商品详情、购物车、下单支付、订单状态、余额与积分、纸质/电子水票、优惠券和会员中心；送水员侧包含账号登录、配送工作台、新派单提醒、订单详情、联系客户、主动签收、水票核销和来电信息展示。H5 与微信小程序共用 Vue 3 页面和统一水业务 API。

## 技术栈

- uni-app 3、Vue 3.4、uni-components
- Vite 5、JavaScript、Sass
- 微信小程序、H5、App 多端构建
- ESLint、Vue TSC、浏览器交互回归脚本

## 关联仓库

| 项目 | 说明 | GitHub |
| --- | --- | --- |
| mountain-spring-water-backend | 后端服务 | [mountain-spring-water-backend](https://github.com/jiangyi3265/mountain-spring-water-backend) |
| mountain-spring-water-admin | 管理后台 | [mountain-spring-water-admin](https://github.com/jiangyi3265/mountain-spring-water-admin) |
| mountain-spring-water-app | 用户端与送水员端 | [mountain-spring-water-app](https://github.com/jiangyi3265/mountain-spring-water-app) |

## 快速启动

需要 Node.js 18+。先启动 `mountain-spring-water-backend` 中的 Node 水业务 API，再执行：

```bash
npm install
cp .env.example .env.local
npm run dev:h5
```

Windows PowerShell 可使用：

```powershell
Copy-Item .env.example .env.local
npm run dev:h5
```

微信小程序开发：

```bash
npm run dev:mp-weixin
```

随后使用微信开发者工具打开生成的 `unpackage/dist/dev/mp-weixin`。正式发布前需要在 `manifest.json` 中填写真实微信小程序 AppID，并在微信公众平台配置 HTTPS API 合法域名。

## 构建与检查

```bash
npm run lint
npm run typecheck
npm run build:h5
npm run build:mp-weixin
```

## 项目结构

```text
桶装水/
├─ pages/index/               # 商城首页、分类、搜索、详情和购物车
├─ pages/order/               # 确认订单、支付、订单列表、详情与售后
├─ pages/member/              # 余额、水票、积分、优惠券和会员中心
├─ pages/delivery/            # 送水员登录、派单、配送与主动签收
├─ components/                # 导航、商品、水桶和支付等共享组件
├─ services/waterApi.js       # 统一水业务 API 客户端
├─ static/                    # 图片、图标等静态资源
└─ qa/                        # H5 页面和交互回归脚本
```

## 简历描述示例

参与山泉到家 uni-app 多端应用开发，完成用户订水、购物车、订单支付、水票会员与送水员派单签收流程，并通过统一 API 实现客户端、配送端和管理后台状态同步。
