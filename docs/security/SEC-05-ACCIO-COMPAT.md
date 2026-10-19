# SEC-05 Accio Bridge 实例鉴权兼容说明

Bridge 对除 `/health` 外的路由要求实例凭据，并在读请求体之前拒绝。

客户端拉起 Accio 时应写入环境变量 `AI_HELPER_INSTANCE_TOKEN`。请求需携带其一：

- `x-ai-helper-instance: <token>`
- `x-gateway-auth: <token>`
- `Authorization: Bearer <token>`

无凭据、错误凭据、伪造 Origin、DNS Rebinding Host 均失败关闭。监听失败不回退默认端口。

未适配上述头的 Accio 版本将无法调用计费路由，这是预期行为。支持矩阵需用真实 Accio 版本另行记录。
