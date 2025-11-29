"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  ArrowLeft, 
  Save, 
  Eye, 
  Image as ImageIcon,
  Bold,
  Italic,
  Link as LinkIcon,
  List,
  Code
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";

export default function NewBlogPost() {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [featuredImage, setFeaturedImage] = useState('');
  const [status, setStatus] = useState<'draft' | 'published'>('draft');
  const [isLoading, setIsLoading] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  const router = useRouter();

  const addTag = () => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      setTags([...tags, newTag.trim()]);
      setNewTag('');
    }
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  };

  const uploadImage = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/admin/blogs/upload-media', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        return data.url;
      } else {
        throw new Error('Failed to upload image');
      }
    } catch (error) {
      console.error('Error uploading image:', error);
      alert('Failed to upload image');
      return null;
    }
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const url = await uploadImage(file);
    if (url) {
      // Insert markdown image syntax at cursor position
      const textarea = document.getElementById('content-textarea') as HTMLTextAreaElement;
      const cursorPosition = textarea.selectionStart;
      const imageMarkdown = `![${file.name}](${url})`;
      
      const newContent = 
        content.substring(0, cursorPosition) + 
        imageMarkdown + 
        content.substring(cursorPosition);
      
      setContent(newContent);
    }
  };

  const insertMarkdown = (before: string, after: string = '') => {
    const textarea = document.getElementById('content-textarea') as HTMLTextAreaElement;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = content.substring(start, end);
    
    const newContent = 
      content.substring(0, start) + 
      before + selectedText + after + 
      content.substring(end);
    
    setContent(newContent);
    
    // Restore cursor position
    setTimeout(() => {
      textarea.selectionStart = start + before.length;
      textarea.selectionEnd = start + before.length + selectedText.length;
      textarea.focus();
    }, 0);
  };

  const saveBlogPost = async () => {
    if (!title.trim() || !content.trim()) {
      alert('Please fill in title and content');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/admin/blogs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: title.trim(),
          content: content.trim(),
          excerpt: excerpt.trim(),
          tags,
          featured_image: featuredImage.trim(),
          status,
        }),
      });

      if (response.ok) {
        router.push('/admin');
      } else {
        const error = await response.json();
        alert(`Failed to save blog post: ${error.error}`);
      }
    } catch (error) {
      console.error('Error saving blog post:', error);
      alert('Failed to save blog post');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <Button variant="ghost" size="sm" asChild>
                <Link href="/admin">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Admin
                </Link>
              </Button>
              <h1 className="text-xl font-bold text-foreground">Create New Blog Post</h1>
            </div>
            <div className="flex items-center space-x-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsPreview(!isPreview)}
              >
                <Eye className="h-4 w-4 mr-2" />
                {isPreview ? 'Edit' : 'Preview'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStatus(status === 'draft' ? 'published' : 'draft')}
              >
                {status === 'draft' ? 'Save as Draft' : 'Published'}
              </Button>
              <Button
                onClick={saveBlogPost}
                disabled={isLoading}
                size="sm"
              >
                <Save className="h-4 w-4 mr-2" />
                {isLoading ? 'Saving...' : 'Save Post'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-3">
            <div className="space-y-6">
              {/* Title */}
              <div>
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Enter blog post title..."
                  className="text-lg"
                />
              </div>

              {/* Excerpt */}
              <div>
                <Label htmlFor="excerpt">Excerpt</Label>
                <textarea
                  id="excerpt"
                  value={excerpt}
                  onChange={(e) => setExcerpt(e.target.value)}
                  placeholder="Brief description of the blog post..."
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground resize-none"
                  rows={3}
                />
              </div>

              {/* Content Editor */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label htmlFor="content">Content</Label>
                  <div className="flex items-center space-x-2">
                    {/* Markdown toolbar */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => insertMarkdown('**', '**')}
                      title="Bold"
                    >
                      <Bold className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => insertMarkdown('*', '*')}
                      title="Italic"
                    >
                      <Italic className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => insertMarkdown('[', '](url)')}
                      title="Link"
                    >
                      <LinkIcon className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => insertMarkdown('\n- ', '')}
                      title="List"
                    >
                      <List className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => insertMarkdown('`', '`')}
                      title="Code"
                    >
                      <Code className="h-4 w-4" />
                    </Button>
                    <div className="relative">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleImageUpload}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <Button variant="ghost" size="sm" title="Upload Image">
                        <ImageIcon className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
                
                {isPreview ? (
                  <div className="border border-border rounded-md p-4 bg-background min-h-[400px]">
                    <div className="prose prose-sm max-w-none dark:prose-invert">
                      {/* Simple markdown preview - in a real app you'd use a proper markdown renderer */}
                      <div className="whitespace-pre-wrap">{content}</div>
                    </div>
                  </div>
                ) : (
                  <textarea
                    id="content-textarea"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="Write your blog post content in Markdown..."
                    className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground font-mono text-sm resize-none"
                    rows={20}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Featured Image */}
            <div className="bg-card border border-border rounded-lg p-4">
              <Label htmlFor="featured-image" className="text-sm font-medium">Featured Image URL</Label>
              <Input
                id="featured-image"
                value={featuredImage}
                onChange={(e) => setFeaturedImage(e.target.value)}
                placeholder="https://..."
                className="mt-2"
              />
              {featuredImage && (
                <div className="mt-2">
                  <Image
                    src={featuredImage}
                    alt="Featured"
                    width={400}
                    height={128}
                    className="w-full h-32 object-cover rounded border"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                </div>
              )}
            </div>

            {/* Tags */}
            <div className="bg-card border border-border rounded-lg p-4">
              <Label className="text-sm font-medium">Tags</Label>
              <div className="flex flex-wrap gap-2 mt-2 mb-3">
                {tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="cursor-pointer"
                    onClick={() => removeTag(tag)}
                  >
                    {tag} ×
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addTag()}
                  placeholder="Add tag..."
                  className="flex-1"
                />
                <Button onClick={addTag} size="sm">Add</Button>
              </div>
            </div>

            {/* Status */}
            <div className="bg-card border border-border rounded-lg p-4">
              <Label className="text-sm font-medium">Status</Label>
              <div className="mt-2">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as 'draft' | 'published')}
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                </select>
              </div>
            </div>

            {/* Markdown Help */}
            <div className="bg-card border border-border rounded-lg p-4">
              <Label className="text-sm font-medium mb-2 block">Markdown Help</Label>
              <div className="text-xs text-muted-foreground space-y-1">
                <div># Heading 1</div>
                <div>## Heading 2</div>
                <div>**Bold text**</div>
                <div>*Italic text*</div>
                <div>[Link](url)</div>
                <div>![Image](url)</div>
                <div>- List item</div>
                <div>`Code`</div>
                <div>```code block```</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}