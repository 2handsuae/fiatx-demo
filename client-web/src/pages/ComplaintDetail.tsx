import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { CustomerSessionError, customerFetch } from '../utils/customerFetch';
import { StatusBadge } from '../components/StatusBadge';
import Field from '../components/detail/Field';
import { useGoBack } from '../components/detail/useGoBack';
import { Timeline } from '../components/detail/Timeline';
import {
  COMPLAINT_CATEGORY_LABEL, COMPLAINT_JOURNEY_STEP_LABEL, COMPLAINT_MESSAGE_TYPE_LABEL,
  COMPLAINT_RESOLUTION_OUTCOME_LABEL, getComplaintStatusView,
} from '../utils/complaintStatusView';

interface Entry {
  kind: string;
  messageType: string | null;
  body: string;
  createdAt: string;
}

interface ComplaintDetailData {
  complaintNo: string;
  category: string;
  relatedOrderNo: string | null;
  subject: string;
  description: string;
  currentStatus: string;
  submittedAt: string;
  acknowledgedAt: string | null;
  extendedAt: string | null;
  resolvedAt: string | null;
  resolutionOutcome: string | null;
  resolutionText: string | null;
  entries: Entry[];
}

const ComplaintDetail = () => {
  const { complaintNo } = useParams();
  const goBack = useGoBack('/complaints');
  const [complaint, setComplaint] = useState<ComplaintDetailData | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await customerFetch(
          `${import.meta.env.VITE_API_URL}/client/me/complaints/${complaintNo}`,
        );
        if (!r.ok) throw new Error('not found');
        const d = await r.json();
        if (alive) setComplaint(d);
      } catch (error) {
        // customerFetch 自己会在会话过期时跳转登录页；这里只处理"单子真找不到"，
        // 别在跳转前的一瞬间闪出一条误导性的错误文案（与 DepositDetail.tsx 一致）。
        if (error instanceof CustomerSessionError) return;
        if (alive) setErr('This complaint is not available.');
      }
    })();
    return () => { alive = false; };
  }, [complaintNo]);

  if (err) return <div className="max-w-4xl mx-auto text-fx-dust">{err}</div>;
  if (!complaint) return <div className="max-w-4xl mx-auto text-fx-dust">Loading…</div>;

  const view = getComplaintStatusView(complaint.currentStatus);

  // 状态时间线（人话标签，spec §3）——四个时间戳 + 状态推导的人话步骤，非源自术语状态码。
  const journey: { label: string; at: string }[] = [
    { label: COMPLAINT_JOURNEY_STEP_LABEL.SUBMITTED, at: complaint.submittedAt },
  ];
  if (complaint.acknowledgedAt) journey.push({ label: COMPLAINT_JOURNEY_STEP_LABEL.ACKNOWLEDGED, at: complaint.acknowledgedAt });
  if (complaint.extendedAt) journey.push({ label: COMPLAINT_JOURNEY_STEP_LABEL.EXTENDED, at: complaint.extendedAt });
  if (complaint.resolvedAt) journey.push({ label: COMPLAINT_JOURNEY_STEP_LABEL.RESOLVED, at: complaint.resolvedAt });

  return (
    <div className="max-w-4xl mx-auto">
      <button onClick={goBack} className="flex items-center gap-2 text-sm text-fx-dust hover:text-fx-brass mb-6">
        <ArrowLeft size={16} /> Complaints
      </button>

      <div className="flex items-start justify-between gap-4 pb-6 border-b border-fx-rule">
        <div>
          <div className="text-xl font-bold text-fx-sand">{complaint.subject}</div>
          <div className="font-mono text-xs text-fx-dust mt-1">
            {complaint.complaintNo} · {COMPLAINT_CATEGORY_LABEL[complaint.category] ?? complaint.category}
          </div>
        </div>
        <StatusBadge view={view} />
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-fx-sand mb-3">Details</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Description" value={complaint.description} wide />
          {complaint.relatedOrderNo && <Field label="Related order" value={complaint.relatedOrderNo} mono />}
          {complaint.resolutionOutcome && (
            <Field label="Outcome" value={COMPLAINT_RESOLUTION_OUTCOME_LABEL[complaint.resolutionOutcome] ?? complaint.resolutionOutcome} />
          )}
        </dl>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-fx-sand mb-3">Progress</h2>
        <Timeline items={journey} />
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-fx-sand mb-3">Correspondence</h2>
        {complaint.entries.length === 0 ? (
          <p className="text-sm text-fx-dust">No written correspondence yet.</p>
        ) : (
          <div className="space-y-3">
            {complaint.entries.map((entry, i) => (
              <div key={i} className="rounded-xl bg-fx-charcoal/40 px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-fx-brass">
                    {entry.messageType ? COMPLAINT_MESSAGE_TYPE_LABEL[entry.messageType] ?? entry.messageType : 'Message'}
                  </span>
                  <span className="font-mono text-[10px] text-fx-dust">{new Date(entry.createdAt).toLocaleString()}</span>
                </div>
                <p className="mt-1.5 text-sm text-fx-sand whitespace-pre-wrap">{entry.body}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default ComplaintDetail;
