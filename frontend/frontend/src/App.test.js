import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import App from "./App";

beforeEach(() => {
  window.localStorage.clear();
});

test("renders login form before authentication", () => {
  render(<App />);

  expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
});

test("renders primary navigation tabs after login", async () => {
  render(<App />);

  fireEvent.change(screen.getByLabelText(/email address/i), {
    target: { value: "tester@example.com" },
  });
  fireEvent.change(screen.getByLabelText(/password/i), {
    target: { value: "password123" },
  });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

  await waitFor(() =>
    expect(screen.getByRole("button", { name: /^dashboard$/i })).toBeInTheDocument()
  );
  expect(screen.getByRole("button", { name: /^analyze$/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^insights$/i })).toBeInTheDocument();
});
