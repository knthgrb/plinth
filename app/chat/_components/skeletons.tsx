"use client";

export function ConversationSkeleton() {
  return (
    <div className="p-4 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-gray-200" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-3/4 bg-gray-200 rounded" />
          <div className="h-3 w-1/2 bg-gray-200 rounded" />
        </div>
        <div className="h-3 w-12 bg-gray-200 rounded" />
      </div>
    </div>
  );
}

export function MessageSkeleton({ isOwnMessage }: { isOwnMessage: boolean }) {
  return (
    <div
      className={`flex ${isOwnMessage ? "justify-end" : "justify-start"} animate-pulse`}
    >
      <div
        className={`max-w-[70%] rounded-lg px-4 py-2 ${
          isOwnMessage ? "bg-gray-200" : "bg-gray-100"
        }`}
      >
        {!isOwnMessage && <div className="h-3 w-20 bg-gray-300 rounded mb-2" />}
        <div className="h-4 w-48 bg-gray-300 rounded mb-1" />
        <div className="h-3 w-16 bg-gray-300 rounded" />
      </div>
    </div>
  );
}

export function ConversationListSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <ConversationSkeleton key={i} />
      ))}
    </>
  );
}

export function MessageListSkeleton() {
  return (
    <div className="space-y-4 p-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <MessageSkeleton key={i} isOwnMessage={i % 2 === 0} />
      ))}
    </div>
  );
}
