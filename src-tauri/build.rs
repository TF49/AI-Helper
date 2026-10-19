fn load_env_file(path: &std::path::Path) {
    if path.exists() {
        println!("cargo:rerun-if-changed={}", path.display());
        if let Ok(content) = std::fs::read_to_string(path) {
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') {
                    continue;
                }
                if let Some((key, val)) = trimmed.split_once('=') {
                    let key = key.trim();
                    let mut val = val.trim();
                    if (val.starts_with('"') && val.ends_with('"'))
                        || (val.starts_with('\'') && val.ends_with('\''))
                    {
                        val = &val[1..val.len() - 1];
                    }
                    let upper = key.to_ascii_uppercase();
                    if upper.contains("WEBHOOK")
                        || upper.contains("SECRET")
                        || upper.contains("PRIVATE")
                        || upper.contains("PASSWORD")
                    {
                        continue;
                    }
                    if std::env::var(key).is_err() {
                        println!("cargo:rustc-env={}={}", key, val);
                    }
                }
            }
        }
    }
}

fn main() {
    tauri_build::build();

    let manifest_dir = std::path::PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("missing CARGO_MANIFEST_DIR"),
    );

    // 自动加载本地 .env（根目录或 src-tauri），编译期无缝注入并规避 Git 提交泄露
    load_env_file(&manifest_dir.join("../.env"));
    load_env_file(&manifest_dir.join(".env"));

    // Windows: Embed Common Controls v6 manifest for test binaries
    #[cfg(target_os = "windows")]
    {
        let manifest_path = manifest_dir.join("common-controls.manifest");
        let manifest_arg = format!("/MANIFESTINPUT:{}", manifest_path.display());

        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg={}", manifest_arg);
        // Avoid duplicate manifest resources in binary builds.
        println!("cargo:rustc-link-arg-bins=/MANIFEST:NO");
        println!("cargo:rerun-if-changed={}", manifest_path.display());
    }
}
