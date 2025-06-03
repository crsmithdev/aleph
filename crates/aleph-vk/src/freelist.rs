use {
    crate::{allocator::AllocationId, Allocator},
    anyhow::Result,
    std::{
        collections::HashMap,
        sync::{Arc, Mutex},
    },
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct FreeListId(u64);

#[derive(Debug, Copy, Clone)]
struct Block {
    offset: u64,
    size: u64,
}

#[derive(Debug)]
pub struct SubBuffer {
    buffer_id: AllocationId,
    allocator: Arc<Allocator>,
    freelist_id: FreeListId,
    freelist: Arc<FreeList>,
}

impl SubBuffer {
    pub fn write<T: Copy>(&self, offset: u64, data: &[T]) -> Result<()> {
        if let Some(base_offset) = self.freelist.offset(self.freelist_id) {
            let absolute_offset = base_offset + offset;
            self.allocator.write_buffer(self.buffer_id, absolute_offset, data)
        } else {
            panic!("Invalid sub-allocation ID: {:?}", self.freelist_id);
        }
    }

    pub fn write_all<T: Copy>(&self, data: &[T]) -> Result<()> { self.write(0, data) }

    pub fn offset(&self) -> u64 {
        self.freelist.offset(self.freelist_id).expect("Invalid sub-allocation")
    }

    pub fn size(&self) -> u64 {
        self.freelist.size(self.freelist_id).expect("Invalid sub-allocation")
    }

    pub fn handle(&self) -> ash::vk::Buffer { self.allocator.get_buffer(self.buffer_id) }
}

impl Drop for SubBuffer {
    fn drop(&mut self) { self.freelist.free(self.freelist_id); }
}

#[derive(Debug)]
pub struct FreeList {
    total_size: u64,
    allocations: Arc<Mutex<HashMap<FreeListId, Block>>>,

    free_blocks: Arc<Mutex<Vec<Block>>>,
    next_id: Arc<Mutex<u64>>,
}

impl FreeList {
    pub fn new(total_size: u64) -> Arc<Self> {
        let mut free_blocks = Vec::new();
        free_blocks.push(Block {
            offset: 0,
            size: total_size,
        });

        Arc::new(Self {
            total_size,
            allocations: Arc::new(Mutex::new(HashMap::new())),
            free_blocks: Arc::new(Mutex::new(free_blocks)),
            next_id: Arc::new(Mutex::new(0)),
        })
    }

    pub fn allocate(self: &Arc<Self>, size: u64, alignment: u64) -> Option<FreeListId> {
        let mut free_blocks = self.free_blocks.lock().unwrap();
        let mut allocations = self.allocations.lock().unwrap();

        for (i, block) in free_blocks.iter().enumerate() {
            let aligned_offset = (block.offset + alignment - 1) & !(alignment - 1);
            let end_offset = aligned_offset + size;

            if end_offset <= block.offset + block.size {
                let id = FreeListId(*self.next_id.lock().unwrap());
                *self.next_id.lock().unwrap() += 1;

                allocations.insert(
                    id,
                    Block {
                        offset: aligned_offset,
                        size,
                    },
                );

                let remaining_start = end_offset;
                let remaining_size = (block.offset + block.size) - end_offset;

                let old_block = free_blocks.remove(i);

                if aligned_offset > old_block.offset {
                    free_blocks.push(Block {
                        offset: old_block.offset,
                        size: aligned_offset - old_block.offset,
                    });
                }
                if remaining_size > 0 {
                    free_blocks.push(Block {
                        offset: remaining_start,
                        size: remaining_size,
                    });
                }

                return Some(id);
            }
        }
        None
    }

    pub fn free(&self, id: FreeListId) {
        let mut allocations = self.allocations.lock().unwrap();
        let mut free_blocks = self.free_blocks.lock().unwrap();

        if let Some(block) = allocations.remove(&id) {
            free_blocks.push(block);
            self.coalesce_free_blocks(&mut free_blocks);
        }
    }

    fn coalesce_free_blocks(&self, free_blocks: &mut Vec<Block>) {
        free_blocks.sort_by_key(|block| block.offset);

        let mut i = 0;
        while i + 1 < free_blocks.len() {
            let current = free_blocks[i];
            let next = free_blocks[i + 1];

            if current.offset + current.size == next.offset {
                free_blocks[i] = Block {
                    offset: current.offset,
                    size: current.size + next.size,
                };
                free_blocks.remove(i + 1);
            } else {
                i += 1;
            }
        }
    }

    pub fn offset(&self, id: FreeListId) -> Option<u64> {
        let allocations = self.allocations.lock().unwrap();
        allocations.get(&id).map(|block| block.offset)
    }

    pub fn size(&self, id: FreeListId) -> Option<u64> {
        let allocations = self.allocations.lock().unwrap();
        allocations.get(&id).map(|block| block.size)
    }
}

#[cfg(test)]
mod tests {
    use {
        super::*,
        crate::test::test_gpu,
        ash::vk::{BufferCreateInfo, BufferUsageFlags, SharingMode},
        assay::assay,
        gpu_allocator::MemoryLocation,
    };

    #[assay]
    fn test_basic_allocation() {
        let freelist = FreeList::new(1024);

        let id1 = freelist.allocate(100, 1).expect("Should allocate");
        assert_eq!(freelist.offset(id1), Some(0));
        assert_eq!(freelist.size(id1), Some(100));

        let id2 = freelist.allocate(200, 1).expect("Should allocate");
        assert_eq!(freelist.offset(id2), Some(100));
        assert_eq!(freelist.size(id2), Some(200));
    }

    #[assay]
    fn test_alignment() {
        let freelist = FreeList::new(1024);

        let id1 = freelist.allocate(50, 1).expect("Should allocate");
        assert_eq!(freelist.offset(id1), Some(0));

        let id2 = freelist.allocate(100, 256).expect("Should allocate");
        assert_eq!(freelist.offset(id2), Some(256));
    }

    #[assay]
    fn test_free_and_reuse() {
        let freelist = FreeList::new(1024);

        let id1 = freelist.allocate(100, 1).expect("Should allocate");
        let id2 = freelist.allocate(100, 1).expect("Should allocate");

        freelist.free(id1);

        let id3 = freelist.allocate(50, 1).expect("Should reuse freed space");
        assert_eq!(freelist.offset(id3), Some(0));
    }

    #[assay]
    fn test_coalescing() {
        let freelist = FreeList::new(1024);

        let id1 = freelist.allocate(100, 1).expect("Should allocate");
        let id2 = freelist.allocate(100, 1).expect("Should allocate");
        let id3 = freelist.allocate(100, 1).expect("Should allocate");

        freelist.free(id1);
        freelist.free(id2);

        let id4 = freelist.allocate(200, 1).expect("Should allocate coalesced space");
        assert_eq!(freelist.offset(id4), Some(0));
    }

    #[assay]
    fn test_out_of_space() {
        let freelist = FreeList::new(100);

        let _id1 = freelist.allocate(50, 1).expect("Should allocate");
        let _id2 = freelist.allocate(50, 1).expect("Should allocate");

        let id3 = freelist.allocate(1, 1);
        assert!(id3.is_none());
    }

    #[assay]
    fn test_invalid_id_queries() {
        let freelist = FreeList::new(1024);
        let fake_id = FreeListId(999);

        assert_eq!(freelist.offset(fake_id), None);
        assert_eq!(freelist.size(fake_id), None);
    }
}
