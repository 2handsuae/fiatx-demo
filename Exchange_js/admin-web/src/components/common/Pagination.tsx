import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
}) => {
  const totalPages = Math.ceil(totalItems / pageSize);

  if (totalPages <= 1) return null;

  return (
    <div className="border-t border-adm-border bg-adm-panel px-6 py-3 flex items-center justify-between">
      <span className="font-mono text-[10px] text-adm-t3">
        Showing {Math.min(totalItems, (currentPage - 1) * pageSize + 1)} to {Math.min(totalItems, currentPage * pageSize)} of {totalItems} entries
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          className="rounded border border-adm-border bg-adm-bg text-adm-t2 hover:border-adm-amber hover:text-adm-amber disabled:opacity-30 disabled:cursor-not-allowed transition-colors p-1"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="font-mono text-[10px] text-adm-t2 bg-adm-bg border border-adm-border px-3 py-1">
          Page {currentPage} of {totalPages}
        </span>
        <button
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage >= totalPages}
          className="rounded border border-adm-border bg-adm-bg text-adm-t2 hover:border-adm-amber hover:text-adm-amber disabled:opacity-30 disabled:cursor-not-allowed transition-colors p-1"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
};

export default Pagination;
