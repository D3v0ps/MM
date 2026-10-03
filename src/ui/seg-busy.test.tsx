// @vitest-environment jsdom
// Seg busy (närvaroraderna medan ett kommando pågår): klick ignoreras, aria-disabled och aria-busy sätts, fokus stannar
// kvar (ingen disabled på knapparna – som Button pending).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Seg } from "./form";

afterEach(cleanup);

describe("Seg busy", () => {
  it("busy: klick gör ingenting, knapparna är aria-disabled men inte disabled; utan busy fungerar klick", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Seg ariaLabel="Närvaro" value={null} onValueChange={onChange} options={["Närvarande", "Sen"]} busy />);
    const group = screen.getByRole("group", { name: "Närvaro" });
    expect(group.getAttribute("aria-busy")).toBe("true");
    const btn = screen.getByRole("button", { name: "Närvarande" });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    btn.focus();
    fireEvent.click(btn);
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(btn);
    rerender(<Seg ariaLabel="Närvaro" value={null} onValueChange={onChange} options={["Närvarande", "Sen"]} />);
    expect(group.getAttribute("aria-busy")).toBeNull();
    expect(btn.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(btn);
    expect(onChange).toHaveBeenCalledWith("Närvarande");
  });
});
