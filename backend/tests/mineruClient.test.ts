import axios from "axios";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("axios", () => ({
  default: {
    post: vi.fn(),
    get: vi.fn()
  }
}));

const mockedAxios = axios as unknown as {
  post: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
};

let MinerUClient: typeof import("../src/services/mineruClient.js").MinerUClient;

describe("MinerUClient", () => {
  beforeAll(async () => {
    process.env.MINERU_TOKEN = "test-token";

    const module = await import("../src/services/mineruClient.js");
    MinerUClient = module.MinerUClient;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("会把带有具体接口路径的 baseUrl 归一化为根地址", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        code: 0,
        data: {
          batch_id: "batch-1",
          file_urls: ["https://example.com/upload"]
        }
      }
    });

    const client = new MinerUClient({
      baseUrl: "https://mineru.net/api/v4/file-urls/batch",
      token: "token"
    });

    await client.requestUploadUrls("paper.pdf");

    expect(mockedAxios.post).toHaveBeenCalledWith(
      "https://mineru.net/api/v4/file-urls/batch",
      expect.any(Object),
      expect.any(Object)
    );
  });

  it("在 MinerU 返回业务错误码时直接抛出失败", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        code: -60012,
        msg: "task not found or expire"
      }
    });

    const client = new MinerUClient({
      baseUrl: "https://mineru.net/api/v4",
      token: "token"
    });

    await expect(client.getBatchResults("batch-1")).rejects.toThrow(
      "task not found or expire"
    );

    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://mineru.net/api/v4/extract-results/batch/batch-1",
      expect.any(Object)
    );
  });
});