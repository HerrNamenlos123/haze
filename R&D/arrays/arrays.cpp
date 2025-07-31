

#include <array>
#include <iostream>
#include <string>
#include <vector>

int main()
{
  // Stack array with fixed size
  std::array<int, 4> fixed = { 1, 2, 3, 4 };

  // Vector on heap
  std::vector<std::string> names;
  names.push_back("Alice");
  names.push_back("Bob");

  // Arena allocation for 100 Vec2 elements
  Arena arena(1024 * 1024); // 1 MB arena
  Vec2* positions = arena.allocate_array<Vec2>(100);
  for (int i = 0; i < 100; i++) {
    positions[i] = { float(i), float(i * 2) };
  }

  // Slice/view into a vector
  std::vector<float> values = { 0.1f, 0.2f, 0.3f, 0.4f };
  float* slice_begin = &values[1];
  float* slice_end = &values[3];
  for (float* p = slice_begin; p != slice_end; ++p) {
    std::cout << *p << std::endl;
  }

  // Linked list usage
  std::forward_list<int> chain = { 10, 20, 30 };
  for (int x : chain) {
    std::cout << x << std::endl;
  }

  // Vector of pointers allocated in arena
  std::vector<Entity*> entities;
  for (int i = 0; i < 10; ++i) {
    Entity* e = new (arena.alloc(sizeof(Entity))) Entity();
    entities.push_back(e);
  }

  // Stack array initialized with lambda
  std::array<int, 128> lookup;
  std::generate(lookup.begin(), lookup.end(), [n = 0]() mutable { return n++; });

  // Arena array initialized with lambda
  int* data = arena.allocate_array<int>(128);
  for (int i = 0; i < 128; ++i) {
    data[i] = i * 2;
  }
}
