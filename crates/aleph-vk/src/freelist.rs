use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
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
pub struct FreeList {
    state: Mutex<FreeListState>,
    next_id: AtomicU64,
}

#[derive(Debug)]
struct FreeListState {
    total_size: u64,
    allocations: HashMap<FreeListId, Block>,
    free_blocks: Vec<Block>,
}

impl FreeList {
    pub fn new(total_size: u64) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(FreeListState {
                total_size,
                allocations: HashMap::new(),
                free_blocks: vec![Block {
                    offset: 0,
                    size: total_size,
                }],
            }),
            next_id: AtomicU64::new(0),
        })
    }

    pub fn allocate(&self, size: u64, alignment: u64) -> Option<FreeListId> {
        let mut state = self.state.lock().unwrap();

        for (i, &block) in state.free_blocks.iter().enumerate() {
            let aligned_offset = (block.offset + alignment - 1) & !(alignment - 1);
            let end_offset = aligned_offset + size;

            if end_offset <= block.offset + block.size && end_offset <= state.total_size {
                let id = FreeListId(self.next_id.fetch_add(1, Ordering::Relaxed));

                state.allocations.insert(
                    id,
                    Block {
                        offset: aligned_offset,
                        size,
                    },
                );

                let old_block = state.free_blocks.remove(i);

                if aligned_offset > old_block.offset {
                    state.free_blocks.push(Block {
                        offset: old_block.offset,
                        size: aligned_offset - old_block.offset,
                    });
                }

                let remaining = (old_block.offset + old_block.size) - end_offset;
                if remaining > 0 {
                    state.free_blocks.push(Block {
                        offset: end_offset,
                        size: remaining,
                    });
                }

                return Some(id);
            }
        }
        None
    }

    pub fn offset(&self, id: FreeListId) -> Option<u64> {
        let state = self.state.lock().unwrap();
        state.allocations.get(&id).map(|block| block.offset)
    }

    pub fn size(&self, id: FreeListId) -> Option<u64> {
        let state = self.state.lock().unwrap();
        state.allocations.get(&id).map(|block| block.size)
    }

    pub fn free(&self, id: FreeListId) {
        let mut state = self.state.lock().unwrap();
        if let Some(block) = state.allocations.remove(&id) {
            state.free_blocks.push(block);
            self.coalesce(&mut state.free_blocks);
        }
    }

    fn coalesce(&self, blocks: &mut Vec<Block>) {
        blocks.sort_by_key(|b| b.offset);
        let mut i = 0;
        while i + 1 < blocks.len() {
            if blocks[i].offset + blocks[i].size == blocks[i + 1].offset {
                blocks[i].size += blocks[i + 1].size;
                blocks.remove(i + 1);
            } else {
                i += 1;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_allocation() {
        let freelist = FreeList::new(1024);

        let id1 = freelist.allocate(256, 1).expect("Should allocate 256 bytes");
        let id2 = freelist.allocate(128, 1).expect("Should allocate 128 bytes");

        assert_eq!(freelist.offset(id1), Some(0));
        assert_eq!(freelist.size(id1), Some(256));
        assert_eq!(freelist.offset(id2), Some(256));
        assert_eq!(freelist.size(id2), Some(128));
    }

    #[test]
    fn test_alignment() {
        let freelist = FreeList::new(1024);

        let id1 = freelist.allocate(100, 256).expect("Should allocate with alignment");
        assert_eq!(freelist.offset(id1), Some(0));

        let id2 = freelist.allocate(50, 64).expect("Should allocate with alignment");
        let offset2 = freelist.offset(id2).unwrap();
        assert_eq!(offset2 % 64, 0);
    }

    #[test]
    fn test_free_and_coalesce() {
        let freelist = FreeList::new(1024);

        let id1 = freelist.allocate(256, 1).unwrap();
        let id2 = freelist.allocate(256, 1).unwrap();

        freelist.free(id2);
        freelist.free(id1);

        let id4 = freelist.allocate(512, 1).expect("Should coalesce and fit 512 bytes");
        assert_eq!(freelist.offset(id4), Some(0));
    }

    #[test]
    fn test_allocation_failure() {
        let freelist = FreeList::new(100);

        let id1 = freelist.allocate(50, 1).expect("Should allocate 50 bytes");
        let id2 = freelist.allocate(60, 1);

        assert!(id2.is_none());
        assert_eq!(freelist.offset(id1), Some(0));
    }

    #[test]
    fn test_fragmentation() {
        let freelist = FreeList::new(1000);

        let mut ids = Vec::new();
        for _ in 0..10 {
            ids.push(freelist.allocate(50, 1).unwrap());
        }

        for (i, &id) in ids.iter().enumerate() {
            if i % 2 == 0 {
                freelist.free(id);
            }
        }

        let big_alloc = freelist.allocate(100, 1);
        assert!(big_alloc.is_some());

        let small_alloc = freelist.allocate(25, 1);
        assert!(small_alloc.is_some());
    }

    #[test]
    fn test_invalid_id() {
        let freelist = FreeList::new(1024);
        let fake_id = FreeListId(999);

        assert_eq!(freelist.offset(fake_id), None);
        assert_eq!(freelist.size(fake_id), None);

        freelist.free(fake_id);
    }

    #[test]
    fn test_full_allocation() {
        let freelist = FreeList::new(512);

        let id = freelist.allocate(512, 1).expect("Should allocate entire space");
        assert_eq!(freelist.offset(id), Some(0));
        assert_eq!(freelist.size(id), Some(512));

        let id2 = freelist.allocate(1, 1);
        assert!(id2.is_none());

        freelist.free(id);

        let id3 = freelist.allocate(256, 1).expect("Should allocate after free");
        assert_eq!(freelist.offset(id3), Some(0));
    }
}
