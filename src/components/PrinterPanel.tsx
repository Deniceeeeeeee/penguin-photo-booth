export type PrinterStatus = "idle" | "captured" | "generating" | "printing" | "complete";

export type PrinterPanelProps = {
  status: PrinterStatus;
  progress: number;
  posterDataURL: string | null;
  selectedPosterName?: string;
  onDownload: () => void;
  onRetake: () => void;
};

function getStatusText(status: PrinterStatus) {
  void status;
  return "PRINTING IN PROGRESS....";
}

export function PrinterPanel({
  status,
  progress,
  posterDataURL,
  selectedPosterName,
  onDownload,
  onRetake,
}: PrinterPanelProps) {
  const isPrinting = status === "printing";
  const isComplete = status === "complete";
  const visibleProgress = isComplete ? 100 : isPrinting ? progress : 0;
  const printProgress = Math.min(100, Math.max(0, visibleProgress));

  return (
    <section className="printer-panel" aria-label="Penguin poster printer">
      <div className="printer-machine">
        <div className="printer-display">
          <span
            key={isPrinting ? "printing" : "ready"}
            className={isPrinting ? "printer-display-text is-typing" : "printer-display-text"}
          >
            {getStatusText(status)}
          </span>
          <div
            className="printer-progress battery-progress"
            aria-label="Printing progress"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={printProgress}
            role="progressbar"
          >
            <div className="battery-fill" style={{ width: `${printProgress}%` }} />
          </div>
        </div>
        <div className="printer-mouth" />

        <div className="poster-output" aria-hidden={!posterDataURL}>
          {posterDataURL ? (
            <img
              alt=""
              src={posterDataURL}
              style={{ transform: `translateY(${-100 + printProgress}%)` }}
            />
          ) : null}
        </div>
      </div>

      {isComplete && posterDataURL ? (
        <div className="completed-poster" aria-label="Completed printed poster">
          <p>Here is a surprise for you : )</p>
          <img src={posterDataURL} alt="Completed Penguin Photo Booth poster" />
          <div className="printer-actions">
            <button type="button" onClick={onDownload}>
              Download Poster
            </button>
            <button type="button" onClick={onRetake}>
              Retake
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
