#include <cstddef>
#include <cstring>
#include <new>
#include <type_traits>

// Lifetime tags
struct LifetimeRoot {};
template <typename Parent> struct SubLifetime : Parent {};

// Lifetime compatibility check
template <typename Child, typename Parent> struct is_lifetime_compatible {
  static constexpr bool value = __is_base_of(Parent, Child);
};

// Scoped reference with lifetime
template <typename Lifetime> struct ScopedRef {
  const char *ptr;

  ScopedRef() : ptr(nullptr) {}
  explicit ScopedRef(const char *p) : ptr(p) {}

  template <typename OtherLifetime,
            typename = std::enable_if_t<
                is_lifetime_compatible<OtherLifetime, Lifetime>::value>>
  ScopedRef(const ScopedRef<OtherLifetime> &other) : ptr(other.ptr) {}

  operator const char *() const { return ptr; }
};

// Proxy to check lifetime on assignment for pointer members
template <typename OwnerLifetime, typename RefLifetime>
struct LifetimeCheckedRef {
  ScopedRef<RefLifetime> value;

  LifetimeCheckedRef() : value(nullptr) {}

  // Assign from ScopedRef with lifetime check
  template <typename NewRefLifetime>
  LifetimeCheckedRef &operator=(ScopedRef<NewRefLifetime> newVal) {
    static_assert(
        is_lifetime_compatible<NewRefLifetime, OwnerLifetime>::value,
        "❌ Cannot assign reference from unrelated or longer-lived arena");
    value = ScopedRef<RefLifetime>(newVal);
    return *this;
  }

  // Also allow assigning raw pointer from the same lifetime for convenience
  LifetimeCheckedRef &operator=(const char *p) {
    value = ScopedRef<RefLifetime>(p);
    return *this;
  }

  operator const char *() const { return value.ptr; }
};

// Your plain struct with raw pointer member
struct Foo {
  const char *name;
};

// Wrapper for Foo with lifetime checking proxies for pointer members
template <typename T, typename Lifetime> struct Wrapper {
private:
  T data;

public:
  // Constructor zero-initialize data
  Wrapper() { data.name = nullptr; }

  // Provide lifetime-checked access to `name`
  //   LifetimeCheckedRef<Lifetime, LifetimeRoot> name;

  // Conversion operator to const Foo& for read-only access
  operator const Foo &() const { return data; }

  // Commit the proxy value back to the raw struct before usage
  //   void commit() { data.name = name.value.ptr; }
};

// Arena managing memory and providing wrappers
template <typename Lifetime> struct Arena {
  char *buffer;
  size_t offset;
  size_t capacity;

  Arena(char *buf, size_t cap) : buffer(buf), offset(0), capacity(cap) {}

  ScopedRef<Lifetime> alloc_string(const char *src) {
    size_t len = std::strlen(src) + 1;
    if (offset + len > capacity)
      __builtin_trap();
    char *dst = buffer + offset;
    std::memcpy(dst, src, len);
    offset += len;
    return ScopedRef<Lifetime>{dst};
  }

  // Allocate a WrapperFoo in the arena
  template <typename T> WrapperFoo<Lifetime> *allocate() {
    size_t size = sizeof(WrapperFoo<Lifetime>);
    size_t align = alignof(WrapperFoo<Lifetime>);
    size_t alignedOffset = (offset + align - 1) & ~(align - 1);
    if (alignedOffset + size > capacity)
      __builtin_trap();
    void *ptr = buffer + alignedOffset;
    offset = alignedOffset + size;

    WrapperFoo<Lifetime> *foo = new (ptr) WrapperFoo<Lifetime>();
    return foo;
  }
};

int main() {
  char rootBuf[1024];
  char subBuf[512];

  Arena<LifetimeRoot> root(rootBuf, sizeof(rootBuf));
  Arena<SubLifetime<LifetimeRoot>> sub(subBuf, sizeof(subBuf));

  auto rootStr = root.alloc_string("Root String");
  auto subStr = sub.alloc_string("Sub String");

  auto foo = root.allocate_foo();
  foo->name = rootStr; // OK: same lifetime
  foo->name = subStr;  // OK: subarena string to parent arena Foo

  foo->commit(); // commit proxies to raw Foo

  // Access raw Foo data
  const Foo &rawFoo = *foo;
  // rawFoo.name points to the string allocated in arena

  // Uncommenting below causes error:
  //   auto fooSub = sub.allocate_foo();
  //   fooSub->name = rootStr; // ❌ error: parent arena string to subarena Foo

  return 0;
}
