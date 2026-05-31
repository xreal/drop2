fn main() {
    let dist = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../assets/receiver/dist/index.html");

    if !dist.exists() {
        panic!(
            "missing browser receiver assets at assets/receiver/dist/\n\
             build them first: make receiver"
        );
    }

    let dist_dir = dist.parent().expect("dist path has parent");
    println!("cargo:rerun-if-changed={}", dist_dir.join("index.html").display());
    println!(
        "cargo:rerun-if-changed={}",
        dist_dir.join("app.bundle.js").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        dist_dir.join("styles.css").display()
    );
}
