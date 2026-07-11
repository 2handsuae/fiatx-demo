import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Landmark, X } from 'lucide-react';

/* ────────────────────────────────────────────────────────────────
 *  TradingGateModal — blocking-but-guided overlay shown when a
 *  customer attempts a business action (deposit / swap / withdraw /
 *  send) before they have an active fiat withdrawal address on file.
 *  Calm, single CTA, no punitive tone — mirrors AuthGuard's voice.
 * ──────────────────────────────────────────────────────────────── */

interface TradingGateModalProps {
  open: boolean;
  onClose: () => void;
}

const TradingGateModal = ({ open, onClose }: TradingGateModalProps) => {
  const navigate = useNavigate();

  const handleAddWithdrawalAddress = () => {
    onClose();
    navigate('/withdrawal-addresses');
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="w-full max-w-md rounded-2xl border border-fx-rule bg-fx-ink shadow-2xl"
          >
            <div className="flex items-start justify-between border-b border-fx-rule px-6 py-5">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-fx-brass/10 text-fx-brass">
                  <Landmark size={16} />
                </span>
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-fx-dust">
                    § Withdrawal address required
                  </div>
                  <h3 className="fx-serif text-[18px] text-fx-sand leading-snug">
                    One step before you trade.
                  </h3>
                </div>
              </div>
              <button
                onClick={onClose}
                className="rounded-full p-2 text-fx-dust transition-colors hover:bg-fx-charcoal"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-6">
              <p className="fx-serif text-[14px] leading-[1.7] text-fx-dune">
                To keep your funds always able to reach your bank, we ask every customer to
                add and verify at least one fiat withdrawal address before depositing,
                swapping, or withdrawing. It only takes a minute.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-fx-rule px-6 py-5">
              <button onClick={handleAddWithdrawalAddress} className="fx-btn-primary">
                Add withdrawal address →
              </button>
              <button onClick={onClose} className="fx-btn-ghost">
                Not now
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default TradingGateModal;
