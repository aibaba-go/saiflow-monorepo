# 小程序首页只读刷新实施方案

## 范围与授权
FR-SYS-109 及 AC-01～09，2026-11-09 自主实现授权。STD-006，所有文案 en/th/zh，图标按钮至少44×44，reduced-motion。只刷新真实读取数据，无写操作、页面重载或 LIFF 重启。

## 已观察实现
ScanHome 根据当前 tenant key 重挂载，usage/pending/recent 和 unread 独立查询，ReviewEntry 有自己的 review-summary。上传队列与 URL/选择状态存当前 ScanHome。使用精确查询键、捕获租户/用户生命周期、Promise.allSettled 聚合，不用整个 queryClient.clear、不刷新其它租户缓存。

## 任务
- [x] 添加首页手动刷新按钮、单次并发保护、可访问 loading 状态与成功/部分失败三语反馈；保持上传/URL/选择状态与工作区限制。
- [x] 只 refetch 当前 usage/pending/recent；user 刷 unread，只有可见有资格 ReviewEntry 刷 summary；无tenant不发租户请求；刷新时更新套餐日期参照。
- [x] 测试覆盖成功/连续点击/部分失败保留旧数据/401/游客/无tenant/上传中/旧tenant返回及选中消失数据；浏览器窄屏三语检查。
- [x] 全量回归和代码审查，verification.md 记录 AC 到测试结果，不把模拟接口验证冒充线上验收。

## 检查点
独立 UI 重构只调整此按钮的视觉，不另改刷新逻辑；任何失败不记录全通过。
