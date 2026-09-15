import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

test("list selection previews and applies only chosen metadata fields", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo inventory" }).click();
  await page
    .getByRole("button", { name: "Open Datacenter A", exact: true })
    .click();
  await page.locator('tbody input[type="checkbox"]').nth(0).check();
  await page.locator('tbody input[type="checkbox"]').nth(1).check();
  await expect(
    page.getByRole("region", { name: "Selected components" }),
  ).toContainText("2 selected");
  await page
    .getByRole("button", { name: "Edit selected", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Bulk extra field key").fill("team");
  await dialog.getByRole("button", { name: "Add metadata field" }).click();
  await dialog.getByLabel("team operation").selectOption("set");
  await dialog.getByLabel("team value").fill("platform");
  await dialog.getByRole("button", { name: "Preview changes" }).click();
  await expect(dialog).toContainText("2 of 2 components will change");
  await dialog.getByRole("button", { name: "Apply atomically" }).click();
  await expect(dialog).toHaveCount(0);
  await page.locator(".component-name").first().click();
  await expect(page.locator(".properties")).toContainText("platform");
});

test("diagram modifier selection shares list state and previews directed relations", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo inventory" }).click();
  await page
    .getByRole("button", { name: "Open Datacenter A", exact: true })
    .click();
  await page.locator('tbody input[type="checkbox"]').nth(0).check();
  await page.locator('tbody input[type="checkbox"]').nth(1).check();
  await page.getByRole("button", { name: "Diagram view" }).click();
  const canvas = page.locator(".graph-canvas");
  await expect(page.getByRole("status")).toContainText("Diagram saved");
  // Cytoscape registers its core on the container. Use it only to locate canvas
  // nodes; the actual selection must go through browser pointer gestures.
  const targets = await canvas.evaluate((el: any) =>
    el._cyreg.cy
      .nodes()
      .filter((n: any) => !n.selected() && !n.hasClass("external"))
      .map((n: any) => ({ id: n.id(), ...n.renderedPosition() })),
  );
  await canvas.click({
    position: { x: targets[0].x, y: targets[0].y },
    modifiers: ["Control"],
  });
  await expect(
    page.getByRole("region", { name: "Selected components" }),
  ).toContainText("3 selected");
  await canvas.click({
    position: { x: targets[1].x, y: targets[1].y },
    modifiers: ["Meta"],
  });
  await expect(
    page.getByRole("region", { name: "Selected components" }),
  ).toContainText("4 selected");
  await page
    .getByRole("button", { name: "Link selected", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Target", exact: true })
    .selectOption("replica");
  await dialog.getByLabel("Relation type").fill("test_connection");
  await dialog.getByRole("button", { name: "Preview relationships" }).click();
  await expect(dialog).toContainText("4 relationships to add");
  await dialog.getByRole("button", { name: "Create relationships" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".error-banner")).toHaveCount(0);
});

test("diagram groups persist membership and resize without creating relations", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo inventory" }).click();
  await page
    .getByRole("button", { name: "Open Datacenter A", exact: true })
    .click();
  await page.locator('tbody input[type="checkbox"]').nth(0).check();
  await page.locator('tbody input[type="checkbox"]').nth(1).check();
  await page
    .getByRole("button", { name: "Group selected", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Edge services");
  await dialog.getByRole("button", { name: "Save group", exact: true }).click();
  await page.getByRole("button", { name: "Diagram view" }).click();
  await expect(page.getByRole("status")).toContainText("Diagram saved");
  const canvas = page.locator(".graph-canvas");
  const count = await canvas.evaluate((el: any) => el._cyreg.cy.edges().length);
  await page
    .getByRole("combobox", { name: "Diagram group" })
    .selectOption({ label: "Edge services" });
  await expect(
    page.getByRole("button", { name: "Resize diagram group" }),
  ).toBeAttached();
  await page.getByRole("button", { name: "Edit group", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Minimum width").fill("800");
  await dialog.getByRole("button", { name: "Save group", exact: true }).click();
  await page.getByRole("button", { name: "List view" }).click();
  await page.getByRole("button", { name: "Diagram view" }).click();
  await expect
    .poll(() =>
      canvas.evaluate((el: any) =>
        el._cyreg.cy.nodes(".group").first().data("minWidth"),
      ),
    )
    .toBe(800);
  expect(
    await canvas.evaluate(
      (el: any) => el._cyreg.cy.nodes(".group").first().children().length,
    ),
  ).toBe(2);
  expect(await canvas.evaluate((el: any) => el._cyreg.cy.edges().length)).toBe(
    count,
  );
  await page
    .getByRole("combobox", { name: "Diagram group" })
    .selectOption({ label: "Edge services" });
  await page.getByRole("button", { name: "Fit diagram", exact: true }).click();
  const handle = page.getByRole("button", { name: "Resize diagram group" });
  await expect(handle).toBeVisible();
  const bounds = (await handle.boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 + 30,
    bounds.y + bounds.height / 2 + 20,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect(page.getByRole("status")).toContainText("Diagram saved");
  expect(
    await canvas.evaluate((el: any) =>
      el._cyreg.cy.nodes(".group").first().data("minWidth"),
    ),
  ).toBeGreaterThan(800);
  await page.getByRole("button", { name: "Fit diagram", exact: true }).click();
  await page.screenshot({ path: "test-results/groups.png", fullPage: true });
  await page.getByRole("button", { name: "Edit group", exact: true }).click();
  await page.getByRole("button", { name: "Ungroup members" }).click();
  await expect
    .poll(() =>
      canvas.evaluate((el: any) => el._cyreg.cy.nodes(".group").length),
    )
    .toBe(0);
  expect(await canvas.evaluate((el: any) => el._cyreg.cy.edges().length)).toBe(
    count,
  );
});

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
  await page.getByRole("button", { name: "Review 1 suggestions" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Preview import" }).click();
  await expect(dialog).toContainText("1 to add; 0 to refresh");
  await dialog.getByRole("button", { name: "Apply import" }).click();
  await expect(dialog).toHaveCount(0);
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
  await expect(page.getByRole("button", { name: "Export JSON" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Export encrypted backup" }),
  ).toBeVisible();
  await page
    .getByLabel("Import backup file")
    .setInputFiles({
      name: "legacy.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          ...JSON.parse(
            readFileSync(
              new URL("../../src-tauri/defaults.json", import.meta.url),
              "utf8",
            ),
          ),
          version: 1,
          environments: [
            {
              id: "restored",
              name: "Restored",
              description: "",
              icon: "box",
              color: "#a395f6",
              parent_id: null,
            },
          ],
        }),
      ),
    });
  await expect(
    page.getByRole("dialog", { name: "Restore this inventory?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Replace inventory" }).click();
  await expect(
    page.getByRole("heading", { name: "Infrastructure, in focus." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open Restored", exact: true }),
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
