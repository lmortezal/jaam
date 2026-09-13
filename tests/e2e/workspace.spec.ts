import { test, expect } from "@playwright/test";

test("inventory, graph, custom fields, relationships, import, backup and lock stay local", async ({
  page,
}) => {
  const errors: string[] = [],
    remote: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (!new URL(r.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))
      remote.push(r.url());
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /A private place/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Explore demo inventory" }).click();
  await expect(
    page.getByRole("heading", { name: "Infrastructure, in focus." }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/overview.png", fullPage: true });
  await page
    .getByRole("button", { name: "Open Datacenter A", exact: true })
    .click();
  await expect(page.getByRole("table")).toBeVisible();
  await page
    .getByRole("button", { name: "Internet-facing", exact: true })
    .click();
  await expect(page.locator("tbody tr")).toHaveCount(3);
  await page.getByRole("button", { name: "Reset filters" }).click();
  await page.getByRole("button", { name: "Diagram view" }).click();
  await expect(page.locator(".graph-canvas canvas").first()).toBeVisible();
  await page.screenshot({ path: "test-results/diagram.png", fullPage: true });
  await page.getByRole("button", { name: "List view" }).click();
  await page
    .getByRole("button", { name: "prod-worker-01 Ubuntu 24.04", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Component details" }),
  ).toContainText("10.10.1.21");
  await page.getByRole("button", { name: "Close details" }).click();
  await page
    .getByRole("button", { name: "Add component", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("qa-worker");
  await dialog.getByLabel("Hostname / IP", { exact: true }).fill("10.5.5.5");
  await dialog.getByLabel("SSH user", { exact: true }).fill("ops");
  await dialog.getByRole("button", { name: "Add field", exact: true }).click();
  await dialog.getByLabel("Extra field 1 key").fill("owner");
  await dialog.getByLabel("Extra field 1 value").fill("Platform");
  await dialog
    .getByRole("combobox", { name: "Component type", exact: true })
    .selectOption("custom");
  await dialog
    .getByRole("combobox", { name: "Component type", exact: true })
    .selectOption("server");
  await expect(dialog.getByLabel("Hostname / IP", { exact: true })).toHaveValue(
    "10.5.5.5",
  );
  await expect(dialog.getByLabel("Extra field 1 value")).toHaveValue(
    "Platform",
  );

  await dialog.getByRole("button", { name: "Add relationship" }).click();
  await dialog
    .getByRole("combobox", { name: "Target", exact: true })
    .selectOption("replica");
  await dialog
    .getByRole("button", { name: "Add component", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "qa-worker No version recorded" })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Component details" }),
  ).toContainText("Platform");
  await expect(
    page.getByRole("complementary", { name: "Component details" }),
  ).toContainText("postgres-replica");
  await page.getByRole("button", { name: "Close details" }).click();
  await page
    .getByRole("button", { name: "New environment", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("QA Space");
  await dialog.getByRole("button", { name: "Create environment" }).click();
  await page.getByRole("button", { name: /Import assist LOCAL/ }).click();
  await page.getByRole("button", { name: "Read local configs" }).click();
  await page
    .getByRole("combobox", { name: "Add to environment" })
    .selectOption({ label: "QA Space" });
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Add 1 components" }).click();
  await expect(page.getByRole("heading", { name: "QA Space" })).toBeVisible();
  await expect(page.locator("tbody")).toContainText("demo-host");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "New type" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Queue");
  await dialog.getByRole("button", { name: "Add field", exact: true }).click();
  await dialog.getByLabel("Schema field 1 key").fill("version");
  await dialog.getByLabel("Schema field 1 label").fill("Version");
  await dialog.getByRole("button", { name: "Save component type" }).click();
  await expect(page.locator(".types-list")).toContainText("Queue");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Export JSON" })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/opsportal-.*\.json/);
  const backupPath = await download.path();
  await page.getByLabel("Import backup file").setInputFiles(backupPath!);
  await expect(
    page.getByRole("dialog", { name: "Restore this inventory?" }),
  ).toContainText("5");
  await page.getByRole("button", { name: "Replace inventory" }).click();
  await expect(
    page.getByRole("heading", { name: "Infrastructure, in focus." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open QA Space", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Lock workspace/ }).click();
  await expect(
    page.getByRole("heading", { name: /A private place/ }),
  ).toBeVisible();
  await expect(page.getByText("qa-worker")).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(remote).toEqual([]);
});

test("one-minute idle lock erases all inventory UI", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo inventory" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Auto-lock timeout").selectOption("1");
  await page.clock.fastForward("01:01");
  await expect(
    page.getByRole("heading", { name: /A private place/ }),
  ).toBeVisible();
  await expect(page.getByText("Datacenter A", { exact: true })).toHaveCount(0);
});
