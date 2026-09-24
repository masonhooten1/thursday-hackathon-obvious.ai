import IdentifyScreen from "@/components/IdentifyScreen";

export default function IdentifyPage() {
  return (
    <main className="identify-screen">
      <h1>Plant ID</h1>
      <p className="tagline">Point a camera at a plant, get its name.</p>
      <IdentifyScreen />
    </main>
  );
}
