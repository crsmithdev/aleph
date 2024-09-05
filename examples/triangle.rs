use aleph::prelude::*;

fn main() {
    let mut app = App::builder().build().unwrap();
    app.run(|_| {}).expect(":/");
}
