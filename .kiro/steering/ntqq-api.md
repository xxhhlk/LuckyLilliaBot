# NTQQ API 开发规范

NTQQ 的 API 实际上是通过 PMHQ 远程调用的

`src\ntqqapi\services` 定义了 QQ API 相关的类和方法以及类型，没有具体实现

具体实现是在 `src\ntqqapi\api`，这里的实现就是通过 invoke 调用 PMHQ 的