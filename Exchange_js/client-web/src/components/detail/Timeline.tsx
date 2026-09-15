export interface TimelineItem {
  label: string;
  at: string;
}

export const Timeline = ({ items }: { items: TimelineItem[] }) => {
  if (items.length === 0) return null;

  return (
    <ol>
      {items.map((item, index) => (
        <li key={`${item.label}-${item.at}`} className="relative pl-6 pb-4 last:pb-0">
          {index < items.length - 1 && (
            <span className="absolute left-[3px] top-3 bottom-0 border-l border-fx-rule" />
          )}
          <span className="absolute left-0 top-1.5 h-[7px] w-[7px] rounded-full bg-fx-brass" />
          <div className="text-sm text-fx-sand">{item.label}</div>
          <div className="text-xs font-mono text-fx-dust">{new Date(item.at).toLocaleString()}</div>
        </li>
      ))}
    </ol>
  );
};
