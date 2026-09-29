import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { connectedAccountLabel } from "./composio-connector.js";
import { rasterizeConnectorSVG } from "./connector-logo.js";

describe("native connector presentation", () => {
  it("converts a vector service logo to a native PNG", async () => {
    const png = await rasterizeConnectorSVG(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="red"/></svg>',
    );
    const metadata = await sharp(Buffer.from(png, "base64")).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(96);
  });
  it.each([
    '<svg><image href="file:///private/test"/></svg>',
    '<svg><image href="https://example.test/tracker"/></svg>',
    "<!DOCTYPE svg><svg/>",
    "<svg><script>test()</script></svg>",
  ])("does not render active or externally referenced icon content", async (svg) => {
    await expect(rasterizeConnectorSVG(svg)).rejects.toThrow();
  });
  it("prefers an account email and never treats a credential as its name", () => {
    expect(
      connectedAccountLabel({
        data: { email: "test@example.test", name: "User", access_token: "secret" },
      }),
    ).toBe("test@example.test");
    expect(
      connectedAccountLabel({ data: { access_token: "secret", refresh_token: "secret" } }),
    ).toBeUndefined();
  });
});
