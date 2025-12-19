import dynamic from "next/dynamic";

const EvaluationsContent = dynamic(
  () =>
    import("./_components/evaluations-content").then(
      (m) => m.EvaluationsContent
    ),
  {
    loading: () => <div className="p-8">Loading evaluations...</div>,
  }
);

export default function EvaluationsPage() {
  return <EvaluationsContent />;
}
