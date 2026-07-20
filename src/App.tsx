import "./App.css";
import Toolbar from "./components/Toolbar/Toolbar";
import { open } from "@tauri-apps/plugin-dialog";

const filePath = await open({
  multiple: false,
  filters: [
    {
      name: "PDF",
      extensions: ["pdf"],
    },
  ],
});

const onOpenPdf = () => {
  console.log("asdf");
};

function App() {
  return (
    <div className="h-screen flex items-center justify-center bg-gray-500">
      <h1 className="text-3xl font-bold text-amber-300">
        PDF Floor Plan Markup Tool
        <Toolbar onOpenPdf={() => "asdf"} />
      </h1>
    </div>
  );
}

export default App;
