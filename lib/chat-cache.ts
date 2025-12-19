/**
 * IndexedDB Cache Service for Chat with Encryption
 * Stores conversations and messages locally with encryption
 */

const DB_NAME = "purple-pay-chat";
const DB_VERSION = 1;
const CONVERSATIONS_STORE = "conversations";
const MESSAGES_STORE = "messages";
const ENCRYPTION_KEY_STORE = "encryption_keys";

// Simple encryption using Web Crypto API
class ChatCache {
  private db: IDBDatabase | null = null;
  private encryptionKey: CryptoKey | null = null;
  private orgId: string | null = null;

  async initialize(organizationId: string): Promise<void> {
    this.orgId = organizationId;
    await this.openDB();
    await this.initializeEncryption();
  }

  private async openDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object stores if they don't exist
        if (!db.objectStoreNames.contains(CONVERSATIONS_STORE)) {
          const conversationsStore = db.createObjectStore(CONVERSATIONS_STORE, {
            keyPath: "id",
          });
          conversationsStore.createIndex("organizationId", "organizationId", {
            unique: false,
          });
          conversationsStore.createIndex("updatedAt", "updatedAt", {
            unique: false,
          });
        }

        if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
          const messagesStore = db.createObjectStore(MESSAGES_STORE, {
            keyPath: "id",
          });
          messagesStore.createIndex("conversationId", "conversationId", {
            unique: false,
          });
          messagesStore.createIndex("createdAt", "createdAt", {
            unique: false,
          });
        }

        if (!db.objectStoreNames.contains(ENCRYPTION_KEY_STORE)) {
          db.createObjectStore(ENCRYPTION_KEY_STORE, { keyPath: "orgId" });
        }
      };
    });
  }

  private async initializeEncryption(): Promise<void> {
    if (!this.orgId) return;

    // Try to get existing key from IndexedDB
    const existingKey = await this.getEncryptionKey(this.orgId);
    if (existingKey) {
      this.encryptionKey = existingKey;
      return;
    }

    // Generate new encryption key
    this.encryptionKey = await crypto.subtle.generateKey(
      {
        name: "AES-GCM",
        length: 256,
      },
      true,
      ["encrypt", "decrypt"]
    );

    // Export and store the key
    const exportedKey = await crypto.subtle.exportKey(
      "raw",
      this.encryptionKey
    );
    const keyArray = Array.from(new Uint8Array(exportedKey));

    if (this.db) {
      const transaction = this.db.transaction(
        [ENCRYPTION_KEY_STORE],
        "readwrite"
      );
      const store = transaction.objectStore(ENCRYPTION_KEY_STORE);
      await store.put({
        orgId: this.orgId,
        key: keyArray,
      });
    }
  }

  private async getEncryptionKey(orgId: string): Promise<CryptoKey | null> {
    if (!this.db) return null;

    return new Promise((resolve) => {
      const transaction = this.db!.transaction(
        [ENCRYPTION_KEY_STORE],
        "readonly"
      );
      const store = transaction.objectStore(ENCRYPTION_KEY_STORE);
      const request = store.get(orgId);

      request.onsuccess = async () => {
        const result = request.result;
        if (!result) {
          resolve(null);
          return;
        }

        try {
          const keyData = new Uint8Array(result.key);
          const key = await crypto.subtle.importKey(
            "raw",
            keyData,
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"]
          );
          resolve(key);
        } catch (error) {
          console.error("Error importing encryption key:", error);
          resolve(null);
        }
      };

      request.onerror = () => resolve(null);
    });
  }

  private async encrypt(data: string): Promise<string> {
    if (!this.encryptionKey) {
      throw new Error("Encryption key not initialized");
    }

    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encrypted = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      this.encryptionKey,
      dataBuffer
    );

    // Combine IV and encrypted data
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);

    // Convert to base64 for storage
    return btoa(String.fromCharCode(...combined));
  }

  private async decrypt(encryptedData: string): Promise<string> {
    if (!this.encryptionKey) {
      throw new Error("Encryption key not initialized");
    }

    try {
      // Convert from base64
      const combined = Uint8Array.from(atob(encryptedData), (c) =>
        c.charCodeAt(0)
      );

      const iv = combined.slice(0, 12);
      const encrypted = combined.slice(12);

      const decrypted = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: iv,
        },
        this.encryptionKey!,
        encrypted
      );

      const decoder = new TextDecoder();
      return decoder.decode(decrypted);
    } catch (error) {
      console.error("Decryption error:", error);
      throw error;
    }
  }

  async cacheConversations(conversations: any[]): Promise<void> {
    if (!this.db || !this.orgId) return;

    const transaction = this.db.transaction([CONVERSATIONS_STORE], "readwrite");
    const store = transaction.objectStore(CONVERSATIONS_STORE);

    for (const conv of conversations) {
      try {
        const encrypted = await this.encrypt(JSON.stringify(conv));
        await store.put({
          id: `${this.orgId}_${conv._id}`,
          organizationId: this.orgId,
          conversationId: conv._id,
          data: encrypted,
          updatedAt: conv.lastMessageAt || conv.updatedAt || Date.now(),
        });
      } catch (error) {
        console.error("Error caching conversation:", error);
      }
    }
  }

  async getCachedConversations(): Promise<any[]> {
    if (!this.db || !this.orgId) return [];

    return new Promise((resolve) => {
      const transaction = this.db!.transaction(
        [CONVERSATIONS_STORE],
        "readonly"
      );
      const store = transaction.objectStore(CONVERSATIONS_STORE);
      const index = store.index("organizationId");
      const request = index.getAll(this.orgId!);

      request.onsuccess = async () => {
        const results = request.result;
        const conversations = [];

        for (const item of results) {
          try {
            const decrypted = await this.decrypt(item.data);
            conversations.push(JSON.parse(decrypted));
          } catch (error) {
            console.error("Error decrypting conversation:", error);
          }
        }

        // Sort by updatedAt
        conversations.sort((a, b) => {
          const aTime = a.lastMessage?.createdAt || a.createdAt || 0;
          const bTime = b.lastMessage?.createdAt || b.createdAt || 0;
          return bTime - aTime;
        });

        resolve(conversations);
      };

      request.onerror = () => resolve([]);
    });
  }

  async cacheMessages(conversationId: string, messages: any[]): Promise<void> {
    if (!this.db || !this.orgId) return;

    const transaction = this.db.transaction([MESSAGES_STORE], "readwrite");
    const store = transaction.objectStore(MESSAGES_STORE);

    for (const message of messages) {
      try {
        const encrypted = await this.encrypt(JSON.stringify(message));
        await store.put({
          id: `${this.orgId}_${conversationId}_${message._id}`,
          conversationId: `${this.orgId}_${conversationId}`,
          messageId: message._id,
          data: encrypted,
          createdAt: message.createdAt,
        });
      } catch (error) {
        console.error("Error caching message:", error);
      }
    }
  }

  async getCachedMessages(conversationId: string): Promise<any[]> {
    if (!this.db || !this.orgId) return [];

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([MESSAGES_STORE], "readonly");
      const store = transaction.objectStore(MESSAGES_STORE);
      const index = store.index("conversationId");
      const request = index.getAll(`${this.orgId}_${conversationId}`);

      request.onsuccess = async () => {
        const results = request.result;
        const messages = [];

        for (const item of results) {
          try {
            const decrypted = await this.decrypt(item.data);
            messages.push(JSON.parse(decrypted));
          } catch (error) {
            console.error("Error decrypting message:", error);
          }
        }

        // Sort by createdAt
        messages.sort((a, b) => a.createdAt - b.createdAt);
        resolve(messages);
      };

      request.onerror = () => resolve([]);
    });
  }

  async clearCache(): Promise<void> {
    if (!this.db || !this.orgId) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [CONVERSATIONS_STORE, MESSAGES_STORE],
        "readwrite"
      );

      const conversationsStore = transaction.objectStore(CONVERSATIONS_STORE);
      const messagesStore = transaction.objectStore(MESSAGES_STORE);

      const conversationsIndex = conversationsStore.index("organizationId");
      const conversationsRequest = conversationsIndex.openKeyCursor(
        this.orgId!
      );

      conversationsRequest.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          conversationsStore.delete(cursor.primaryKey);
          cursor.continue();
        } else {
          // Clear messages
          const messagesIndex = messagesStore.index("conversationId");
          const messagesRequest = messagesIndex.openKeyCursor();

          messagesRequest.onsuccess = (msgEvent) => {
            const msgCursor = (msgEvent.target as IDBRequest).result;
            if (msgCursor) {
              if (msgCursor.key.toString().startsWith(`${this.orgId}_`)) {
                messagesStore.delete(msgCursor.primaryKey);
              }
              msgCursor.continue();
            } else {
              resolve();
            }
          };

          messagesRequest.onerror = () => reject(messagesRequest.error);
        }
      };

      conversationsRequest.onerror = () => reject(conversationsRequest.error);
    });
  }
}

export const chatCache = new ChatCache();
