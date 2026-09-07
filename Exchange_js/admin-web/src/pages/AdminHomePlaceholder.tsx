// admin-web/src/pages/AdminHomePlaceholder.tsx
//
// 原 Wave8OpsDashboardPage 两块面板：一块打已删的 /admin/reimbursement-obligations
// （恒 404），一块是 2026-08-30 退役的监管闸门 —— 整页退役。业主定：先放空白占位，
// 「这页以后再优化」。刻意不发任何请求：第一幕开演第一个画面不能有红色网络错误。
export default function AdminHomePlaceholder() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-xl font-semibold text-adm-t1">FiatX Admin</h1>
      <p className="text-sm text-adm-t3">Start from the menu on the left.</p>
    </div>
  );
}
