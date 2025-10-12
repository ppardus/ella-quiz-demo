import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, HashRouter} from "react-router-dom";
import "./index.css";
import App from "./App";
import GeneratePage from "./pages/GeneratePage";
import QuizPage from "./pages/QuizPage";
import SummaryPage from "./pages/SummaryPage";

const router = createBrowserRouter([
  { path: "/", element: <App />, children: [
    { index: true, element: <GeneratePage /> },
    { path: "quiz/:quizId", element: <QuizPage /> },
    { path: "summary/:setId", element: <SummaryPage /> }
  ]},
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* <RouterProvider router={router} /> */}
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>
);
